# TP1100 Respiratory Teaching Rig & Digital Twin Makefile
# Usage:
#   make              - Show this help message
#   make launch       - Start the development server (http://127.0.0.1:8000)
#   make launch-open  - Start the server and automatically open your web browser
#   make test         - Run all test suites
#   make setup        - Install dependencies using uv or venv python

SHELL := /bin/bash

# Configuration variables (can be overridden, e.g. make launch PORT=8001)
HOST ?= 127.0.0.1
PORT ?= 8000
RELOAD ?= --reload

# Environment detection
UV := $(shell command -v uv 2>/dev/null)
PYTHON ?= $(shell if [ -f .venv/bin/python ]; then echo .venv/bin/python; elif command -v python3 >/dev/null 2>&1; then echo python3; else echo python; fi)
NODE ?= $(shell command -v node 2>/dev/null)

# Colors for terminal output
BOLD := \033[1m
GREEN := \033[32m
CYAN := \033[36m
RESET := \033[0m

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help menu
	@echo -e "$(BOLD)TP1100 Respiratory Teaching Rig & Digital Twin$(RESET)"
	@echo -e "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(CYAN)%-16s$(RESET) %s\n", $$1, $$2}'

.PHONY: launch lunch run dev start serve
launch lunch run dev start serve: ## Launch the FastAPI development server with auto-reload
	@echo -e "$(GREEN)Starting Respiratory System Visualizer on http://$(HOST):$(PORT)$(RESET)"
	@if [ -n "$(UV)" ]; then \
		$(UV) run uvicorn app:app --host $(HOST) --port $(PORT) $(RELOAD); \
	else \
		$(PYTHON) -m uvicorn app:app --host $(HOST) --port $(PORT) $(RELOAD); \
	fi

.PHONY: launch-open
launch-open: ## Launch server and automatically open the default web browser
	@echo -e "$(GREEN)Launching server and opening browser at http://$(HOST):$(PORT)...$(RESET)"
	@(sleep 1 && ( $(PYTHON) -m webbrowser "http://$(HOST):$(PORT)/" 2>/dev/null || true )) &
	@$(MAKE) launch

.PHONY: test check
test check: ## Run verification checks (Python/JS syntax and HTML/asset integrity)
	@echo -e "$(CYAN)Verifying Python syntax...$(RESET)"
	@$(PYTHON) -m py_compile app.py
	@echo -e "$(CYAN)Verifying JavaScript syntax and HTML integrity...$(RESET)"
	@if [ -n "$(NODE)" ]; then \
		$(NODE) -c static/app.js check.js && $(NODE) check.js; \
	else \
		echo "Node.js not found, skipping JS checks"; \
	fi
	@echo -e "$(GREEN)All verification checks passed successfully!$(RESET)"

.PHONY: setup install
setup install: ## Install / sync dependencies with uv or pip
	@if [ -n "$(UV)" ]; then \
		echo -e "$(GREEN)Syncing dependencies with uv...$(RESET)"; \
		$(UV) sync; \
	else \
		echo -e "$(GREEN)Installing dependencies into virtual environment...$(RESET)"; \
		$(PYTHON) -m pip install "fastapi>=0.115.0" "uvicorn>=0.34.0"; \
	fi

.PHONY: clean
clean: ## Remove temporary python cache and test artifacts
	@rm -rf __pycache__ static/__pycache__ .pytest_cache
	@find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	@find . -type f -name "*.pyc" -delete 2>/dev/null || true
	@echo -e "$(GREEN)Cleaned cache files.$(RESET)"
