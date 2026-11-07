"""Offline contract/security tests. Run with the optional companion interpreter."""
import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parents[1]))
import auth
import worker
import subscriptions


class SecurityTests(unittest.TestCase):
    def test_origin_and_session_bootstrap(self):
        valid = {'Host': '127.0.0.1:8765', 'Origin': 'http://127.0.0.1:8765', 'X-Notlinear-Agent': '1'}
        self.assertTrue(subscriptions.valid_origin(valid))
        self.assertFalse(subscriptions.valid_origin(dict(valid, Origin='https://attacker.example')))
        self.assertFalse(subscriptions.valid_origin(dict(valid, Host='attacker.example')))
        self.assertFalse(subscriptions.valid_origin({'Host': '127.0.0.1:8765'}))
        self.assertFalse(subscriptions.valid_origin(dict(valid, Origin='null')))

    def test_protected_atomic_credentials(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(auth, 'ROOT', Path(directory)):
            auth.save('test.json', {'access_token': 'test-only'})
            self.assertEqual(auth.load('test.json')['access_token'], 'test-only')
            self.assertEqual((Path(directory) / 'test.json').stat().st_mode & 0o777, 0o600)

    def test_api_environment_is_removed(self):
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test', 'OPENAI_API_KEY': 'test', 'CLAUDE_CODE_OAUTH_TOKEN': 'test'}):
            worker.clean_environment()
            self.assertNotIn('ANTHROPIC_API_KEY', os.environ)
            self.assertNotIn('OPENAI_API_KEY', os.environ)
            self.assertNotIn('CLAUDE_CODE_OAUTH_TOKEN', os.environ)

    def test_native_attachments_and_history(self):
        messages = [{'role':'assistant', 'content':'Parent answer'}, {'role':'user', 'content':[
            {'type':'image', 'source':{'type':'base64', 'media_type':'image/png', 'data':'abc'}},
            {'type':'document', 'source':{'type':'base64', 'media_type':'application/pdf', 'data':'xyz'}},
            {'type':'text', 'text':'Question'}]}]
        translated = worker.to_responses(messages)
        self.assertEqual(translated[0]['content'], 'Parent answer')
        self.assertEqual(translated[1]['content'][0]['image_url'], 'data:image/png;base64,abc')
        self.assertEqual(translated[1]['content'][1]['file_data'], 'data:application/pdf;base64,xyz')
        self.assertIn('Parent answer', json.dumps(worker.claude_input(messages)))
        with self.assertRaises(ValueError):
            worker.to_responses([{'role':'user', 'content':[{'type':'unsupported'}]}])


class SDKTests(unittest.IsolatedAsyncioTestCase):
    async def test_claude_tools_are_restricted(self):
        with patch.object(worker, 'claude_binary', return_value='/test/claude'):
            options = await worker.claude_options()
            self.assertEqual(options.tools, ['WebSearch', 'WebFetch'])
            self.assertEqual(options.setting_sources, [])
            self.assertEqual(options.max_turns, 20)
            self.assertTrue(options.strict_mcp_config)
            denied = await options.can_use_tool('Bash', {'command':'whoami'}, None)
            self.assertEqual(denied.behavior, 'deny')

    async def test_claude_terminal_errors_are_specific_and_safe(self):
        self.assertIn('step limit', worker.claude_error_message(SimpleNamespace(subtype='error_max_turns')))
        self.assertIn('usage limit', worker.claude_error_message(SimpleNamespace(subtype='success', api_error_status=429)))
        self.assertIn('reconnect', worker.claude_error_message(SimpleNamespace(subtype='success', api_error_status=401)))
        message = worker.claude_error_message(SimpleNamespace(subtype='error_during_execution', result='secret prompt'))
        self.assertNotIn('secret prompt', message)
        self.assertIn('partial answer', message)

    async def test_real_agents_runner_with_subscription_wire_contract(self):
        from openai.types.responses import Response, ResponseCompletedEvent, ResponseTextDeltaEvent
        response = Response.model_validate({
            'id':'resp_test', 'object':'response', 'created_at':0, 'status':'completed',
            'model':'test-model', 'parallel_tool_calls':False, 'tool_choice':'auto', 'tools':[],
            'output':[{'id':'msg_test', 'type':'message', 'role':'assistant', 'status':'completed',
                       'content':[{'type':'output_text', 'text':'Ready', 'annotations':[]}]}],
            'usage':{'input_tokens':3, 'output_tokens':1, 'total_tokens':4,
                     'input_tokens_details':{'cached_tokens':0, 'cache_write_tokens':0}, 'output_tokens_details':{'reasoning_tokens':0}}
        })
        delta = ResponseTextDeltaEvent.model_construct(type='response.output_text.delta', delta='Ready',
            item_id='msg_test', output_index=0, content_index=0, sequence_number=0, logprobs=[])
        done = ResponseCompletedEvent.model_construct(type='response.completed', response=response, sequence_number=1)
        requests, events = [], []

        class Stream:
            def __aiter__(self):
                async def iterate():
                    yield delta
                    yield done
                return iterate()
            async def close(self): pass

        class Client:
            def __init__(self, **kwargs): self.responses = self
            async def create(self, **kwargs): requests.append(kwargs); return Stream()
            async def close(self): pass

        with patch('openai.AsyncOpenAI', Client), patch.object(worker, 'access_token', return_value='test-token'), patch.object(worker, 'emit', side_effect=lambda kind, **fields: events.append(dict(type=kind, **fields))):
            await worker.run_chatgpt({'model':'test-model','messages':[{'role':'user','content':'Hello'}], 'systemPrompt':'Be helpful','research':True})
        self.assertEqual(set(requests[0]), {'model','input','instructions','stream','store','tools'})
        self.assertIs(requests[0]['store'], False)
        self.assertIs(requests[0]['stream'], True)
        self.assertEqual(events[-1]['type'], 'done')
        self.assertEqual(events[-1]['text'], 'Ready')
        self.assertEqual(events[-1]['usage']['billing'], 'subscription')


if __name__ == '__main__':
    unittest.main()
