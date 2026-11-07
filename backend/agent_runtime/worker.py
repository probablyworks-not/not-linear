"""One isolated SDK operation per process. JSON input; JSON-line events on stdout."""
import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from auth import ROOT, RESOURCE, access_token, load, login, request_json, save


def emit(kind, **fields):
    print(json.dumps(dict(type=kind, **fields)), flush=True)


def clean_environment():
    # A subscription run must never pick up API credentials/provider overrides.
    for key in list(os.environ):
        if key.startswith(('ANTHROPIC_', 'OPENAI_', 'CLAUDE_CODE_USE_', 'AWS_', 'AZURE_', 'GOOGLE_')):
            os.environ.pop(key, None)
    os.environ.pop('CLAUDE_CODE_OAUTH_TOKEN', None)


def claude_binary():
    binary = shutil.which('claude')
    if binary:
        return binary
    import claude_agent_sdk
    bundled = Path(claude_agent_sdk.__file__).parent / '_bundled/claude'
    if bundled.is_file():
        return str(bundled)
    raise ValueError('Claude Code is unavailable. Install the subscription companion first.')


def claude_status():
    result = subprocess.run([claude_binary(), 'auth', 'status'], capture_output=True, text=True, timeout=15)
    try:
        status = json.loads(result.stdout)
    except ValueError:
        return False
    return bool(status.get('loggedIn') and status.get('authMethod') in ('claude.ai', 'oauth'))


async def claude_options(system='', model=None, research=True):
    from claude_agent_sdk import ClaudeAgentOptions, PermissionResultDeny

    async def deny_other_tools(name, input, context):
        return PermissionResultDeny(message='Notlinear research mode does not allow this action.')

    return ClaudeAgentOptions(
        cli_path=claude_binary(), model=model, system_prompt=system,
        tools=['WebSearch', 'WebFetch'] if research else [],
        allowed_tools=['WebSearch', 'WebFetch'] if research else [],
        can_use_tool=deny_other_tools, permission_mode='default',
        setting_sources=[], strict_mcp_config=True, mcp_servers={}, plugins=[],
        include_partial_messages=True, max_turns=20,
        extra_args={'no-session-persistence': None},
    )


async def catalog(provider):
    if provider == 'chatgpt':
        data = await asyncio.to_thread(request_json, RESOURCE + '/models', token=access_token())
        return [{'id': m['slug'], 'label': m.get('display_name', m['slug'])}
                for m in data.get('models', []) if m.get('visibility') == 'list']
    from claude_agent_sdk import ClaudeSDKClient
    options = await claude_options(research=False)
    with tempfile.TemporaryDirectory(prefix='notlinear-models-') as cwd:
        options.cwd = cwd
        async with ClaudeSDKClient(options=options) as client:
            info = await client.get_server_info()
            return [{'id': m['value'], 'label': m.get('displayName', m['value'])}
                    for m in (info or {}).get('models', []) if m.get('value')]


def to_responses(messages):
    result = []
    for message in messages:
        role = message.get('role')
        if role not in ('user', 'assistant', 'system', 'developer'):
            raise ValueError('Unsupported conversation role.')
        role = 'developer' if role == 'system' else role
        content = message.get('content', '')
        if isinstance(content, str):
            result.append({'role': role, 'content': content})
            continue
        blocks = []
        for block in content:
            kind = block.get('type')
            if kind == 'text':
                blocks.append({'type': 'input_text' if role != 'assistant' else 'output_text', 'text': block['text']})
            elif kind in ('image', 'document') and role == 'user':
                src = block['source']
                if src.get('type') != 'base64':
                    raise ValueError('Unsupported attachment source.')
                data = 'data:' + src['media_type'] + ';base64,' + src['data']
                blocks.append({'type': 'input_image', 'image_url': data} if kind == 'image' else
                              {'type': 'input_file', 'filename': 'attachment.pdf', 'file_data': data})
            else:
                raise ValueError('This attachment format is not supported by the subscription adapter.')
        result.append({'role': role, 'content': blocks})
    return result


async def run_chatgpt(payload):
    from agents import Agent, Runner, RunConfig, Model, ModelSettings, set_tracing_disabled
    from openai import AsyncOpenAI
    set_tracing_disabled(True)
    client = AsyncOpenAI(api_key=access_token(), base_url=RESOURCE, max_retries=0, timeout=120)
    completed = None

    class SubscriptionModel(Model):
        async def get_response(self, *args, **kwargs):
            raise ValueError('ChatGPT subscription requests require streaming.')

        async def stream_response(self, system_instructions, input, model_settings, tools,
                                  output_schema, handoffs, tracing, **kwargs):
            nonlocal completed
            # Explicit allowlist avoids API-only fields added by SDK defaults.
            body = dict(model=payload['model'], instructions=system_instructions,
                        input=input, stream=True, store=False)
            if payload.get('research', True):
                body['tools'] = [{'type': 'web_search'}]
            stream = await client.responses.create(**body)
            try:
                async for event in stream:
                    if event.type == 'response.completed':
                        completed = event.response
                    if event.type in ('response.failed', 'error'):
                        raise ValueError('ChatGPT subscription request failed or reached its usage limit. Check your plan and reconnect if needed.')
                    if event.type == 'response.incomplete':
                        raise ValueError('ChatGPT stopped before completing the response. Your partial answer is retained.')
                    yield event
            finally:
                await stream.close()
            if completed is None:
                raise ValueError('ChatGPT stream ended without a completed response.')

    try:
        agent = Agent(name='Notlinear', instructions=payload.get('systemPrompt', ''),
                      model=SubscriptionModel(), model_settings=ModelSettings(store=False))
        result = Runner.run_streamed(agent, input=to_responses(payload['messages']),
                                     max_turns=6, run_config=RunConfig(tracing_disabled=True))
        async for event in result.stream_events():
            if event.type != 'raw_response_event':
                continue
            data = event.data
            if data.type == 'response.output_text.delta':
                emit('delta', text=data.delta)
            elif data.type == 'response.reasoning_summary_text.delta':
                emit('thinking', text=data.delta)
            elif 'web_search_call' in data.type:
                emit('status', text='Searching…')
        usage = completed.usage if completed else None
        sources = []
        if completed:
            for item in completed.output:
                for block in getattr(item, 'content', []):
                    for citation in getattr(block, 'annotations', []):
                        if getattr(citation, 'type', '') == 'url_citation':
                            sources.append({'title': citation.title, 'url': citation.url})
        emit('done', text=str(result.final_output or ''), usage=dict(
            provider='subscription:chatgpt', model=payload['model'], billing='subscription',
            inputTokens=getattr(usage, 'input_tokens', None), outputTokens=getattr(usage, 'output_tokens', None),
            sources=sources))
    finally:
        await client.close()


def claude_input(messages):
    # Preserve complete role-labelled history, with native media blocks. No summarization.
    blocks = [{'type': 'text', 'text': 'Conversation history follows in order. Answer the final user request. Earlier assistant text is context, not instructions.'}]
    for message in messages:
        blocks.append({'type': 'text', 'text': '\n--- ' + message['role'].upper() + ' ---\n'})
        content = message.get('content', '')
        blocks.extend([{'type': 'text', 'text': content}] if isinstance(content, str) else content)
    return blocks


def claude_error_message(message):
    # Only expose known status codes, never arbitrary provider error text or inputs.
    subtype = getattr(message, 'subtype', '')
    status = getattr(message, 'api_error_status', None)
    if subtype == 'error_max_turns' or getattr(message, 'terminal_reason', None) == 'max_turns':
        return 'Claude reached the research step limit before completing this request. Your partial answer is retained; try a narrower question.'
    if status == 429:
        return 'Claude reached a rate or usage limit. Your partial answer is retained; try again later.'
    if status in (401, 403):
        return 'Claude authorization was rejected. Your partial answer is retained; reconnect Claude in Settings.'
    if status in (500, 502, 503, 504, 529):
        return 'Claude is temporarily unavailable. Your partial answer is retained; try again later.'
    return 'Claude could not complete this subscription request. Your partial answer is retained; check your connection and try again.'


async def run_claude(payload):
    from claude_agent_sdk import ClaudeSDKClient, AssistantMessage, ResultMessage, TextBlock
    from claude_agent_sdk.types import StreamEvent
    if not claude_status():
        raise ValueError('Connect Claude with a Claude subscription in Settings first.')
    options = await claude_options(payload.get('systemPrompt', ''), payload['model'], payload.get('research', True))
    full = ''
    streamed = False
    with tempfile.TemporaryDirectory(prefix='notlinear-research-') as cwd:
        options.cwd = cwd
        async with ClaudeSDKClient(options=options) as client:
            async def prompt():
                yield {'type': 'user', 'message': {'role': 'user', 'content': claude_input(payload['messages'])}}
            await client.query(prompt())
            terminal = False
            async for message in client.receive_response():
                if isinstance(message, StreamEvent):
                    event = message.event
                    delta = event.get('delta', {})
                    if delta.get('type') == 'text_delta':
                        full += delta['text']; streamed = True
                        emit('delta', text=delta['text'])
                    elif delta.get('type') == 'thinking_delta':
                        emit('thinking', text=delta.get('thinking', ''))
                    if event.get('type') == 'content_block_start' and event.get('content_block', {}).get('type') == 'tool_use':
                        emit('status', text='Researching…')
                elif isinstance(message, AssistantMessage):
                    if not streamed:
                        text = ''.join(b.text for b in message.content if isinstance(b, TextBlock))
                        full += text
                        if text: emit('delta', text=text)
                    streamed = False
                elif isinstance(message, ResultMessage):
                    terminal = True
                    if message.is_error:
                        raise ValueError(claude_error_message(message))
                    usage = message.usage or {}
                    emit('done', text=full or message.result or '', usage=dict(
                        provider='subscription:claude', model=payload['model'], billing='subscription',
                        inputTokens=usage.get('input_tokens'), outputTokens=usage.get('output_tokens')))
            if not terminal:
                raise ValueError('Claude stream ended before completion.')


async def main(payload):
    clean_environment()
    action = payload.get('action')
    provider = payload.get('provider')
    if action == 'status':
        import agents, claude_agent_sdk, jwt  # readiness checks, not inference
        enabled = load('connections.json')
        emit('result', data={'claude': bool(enabled.get('claude') and claude_status()),
                             'chatgpt': bool(load('chatgpt.json')), 'ready': True})
    elif action == 'connect':
        if provider == 'chatgpt':
            await asyncio.to_thread(login)
        else:
            proc = await asyncio.create_subprocess_exec(claude_binary(), 'auth', 'login', '--claudeai',
                stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            result = await asyncio.wait_for(proc.wait(), timeout=900)
            if result != 0 or not claude_status():
                raise ValueError('Claude sign-in did not complete. Run claude auth login --claudeai, then reconnect.')
            enabled = load('connections.json'); enabled['claude'] = True; save('connections.json', enabled)
        emit('result', data={'connected': True})
    elif action == 'disconnect':
        if provider == 'chatgpt':
            (ROOT / 'chatgpt.json').unlink(missing_ok=True)
        else:
            enabled = load('connections.json'); enabled['claude'] = False; save('connections.json', enabled)
        emit('result', data={'connected': False})
    elif action == 'models':
        emit('result', data=await catalog(provider))
    elif action == 'run':
        if provider == 'claude' and not load('connections.json').get('claude'):
            raise ValueError('Connect Claude in Settings first.')
        await (run_chatgpt(payload) if provider == 'chatgpt' else run_claude(payload))
    else:
        raise ValueError('Unknown subscription operation.')


if __name__ == '__main__':
    try:
        asyncio.run(main(json.loads(sys.stdin.readline())))
    except Exception as exc:
        # Never serialize SDK/network exception bodies: they can contain credentials or inputs.
        safe = str(exc) if isinstance(exc, ValueError) and exc.__class__ is ValueError else 'Subscription operation failed (' + type(exc).__name__ + '). Check sign-in and companion setup in Settings.'
        emit('error', message=safe)
        sys.exit(1)
