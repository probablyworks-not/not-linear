FROM node:24-bookworm-slim AS frontend
RUN corepack enable
WORKDIR /src
COPY web/package.json web/pnpm-lock.yaml ./web/
RUN cd web && pnpm install --frozen-lockfile
COPY web ./web
COPY backend/cloud/features.json ./backend/cloud/features.json
COPY notlinear-skills ./notlinear-skills
RUN cd web && pnpm run build

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 NOTLINEAR_RUNTIME=cloud NOTLINEAR_DEV_PROXY=0 NOTLINEAR_DATA_DIR=/tmp/notlinear
WORKDIR /srv/notlinear
COPY requirements.txt requirements-cloud.txt ./
RUN pip install --no-cache-dir -r requirements-cloud.txt
COPY backend ./backend
COPY --from=frontend /src/web/dist ./web/dist
COPY CHANGELOG.md logo.svg LICENSE THIRD_PARTY_NOTICES.md ./
RUN useradd --uid 10001 --create-home app
USER app
CMD ["sh","-c","exec uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8080} --no-access-log"]
