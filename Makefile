SHELL := /bin/bash
.DEFAULT_GOAL := help

COMPOSE     := docker compose
RESULTS_DIR := build/test-results

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

.PHONY: up
up: .env ## Start the fixture and the console (http://localhost:5187)
	$(COMPOSE) up -d --build --wait

.PHONY: down
down: ## Stop everything
	$(COMPOSE) down --remove-orphans

.PHONY: dev
dev: .env ## Fixture + vite dev server, no docker
	npm run dev

.PHONY: logs
logs: ## Tail logs
	$(COMPOSE) logs -f --tail=100

.PHONY: test
test: test-unit test-int ## Everything that runs from a clean clone

.PHONY: test-unit
test-unit: $(RESULTS_DIR) ## Unit and component tests
	npx vitest run --project unit --reporter=default --reporter=junit \
		--outputFile.junit=$(RESULTS_DIR)/unit.xml

.PHONY: test-int
test-int: $(RESULTS_DIR) ## Contract suite against the fixture, then the browser tests
	@curl -sf localhost:8022/readyz >/dev/null || { echo "fixture not running: make up (or npm run dev --workspace=fixture)"; exit 1; }
	LEDGER_URL=http://localhost:8022 npx vitest run --project contract \
		--reporter=default --reporter=junit --outputFile.junit=$(RESULTS_DIR)/contract-fixture.xml
	npx playwright test

.PHONY: test-live
test-live: ## Contract suite against a real ledger: make test-live LEDGER_URL=http://localhost:8080
	@test -n "$(LEDGER_URL)" || { echo "usage: make test-live LEDGER_URL=http://..."; exit 1; }
	LEDGER_URL=$(LEDGER_URL) npx vitest run --project contract

.PHONY: lint
lint: ## eslint + tsc
	npm run lint

.PHONY: fmt
fmt: ## prettier
	npx prettier --write console fixture tests e2e

.PHONY: clean
clean: ## Remove build output and containers
	$(COMPOSE) down -v --remove-orphans
	rm -rf build console/dist test-results playwright-report

.env:
	@cp .env.example .env
	@echo "created .env from .env.example"

$(RESULTS_DIR):
	@mkdir -p $(RESULTS_DIR)
