.PHONY: install lint typecheck test build integration e2e check

BOOTLYGA_TOKEN ?= ci-bootlyga-token-018
GATEWAY_URL ?= http://127.0.0.1:8080

install:
	npm ci
	npx playwright install chromium

lint:
	npm run lint

typecheck:
	npm run typecheck

test:
	npm test

build:
	npm run build

integration:
	BOOTLYGA_TOKEN=$(BOOTLYGA_TOKEN) GATEWAY_URL=$(GATEWAY_URL) node scripts/smoke.mjs

e2e:
	./scripts/e2e-stack.sh

check: typecheck lint test build e2e