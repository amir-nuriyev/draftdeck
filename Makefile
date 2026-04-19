SHELL := /bin/bash

.PHONY: setup backend frontend run test test-e2e lint build

setup:
	cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && [ -f .env ] || cp .env.example .env
	cd frontend && npm install && [ -f .env.local ] || cp .env.example .env.local

backend:
	cd backend && source .venv/bin/activate && uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

frontend:
	cd frontend && npm run dev -- --hostname 127.0.0.1 --port 3000

run:
	./run.sh

test:
	cd backend && source .venv/bin/activate && pytest -q
	cd frontend && npm run test:unit

test-e2e:
	cd frontend && npm run test:e2e

lint:
	cd frontend && npm run lint

build:
	cd frontend && npm run build
