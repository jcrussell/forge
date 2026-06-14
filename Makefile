UUID = forge@jmmaranan.com
INSTALL_PATH = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
MSGSRC = $(wildcard po/*.po)

# Shell configuration - explicitly use bash for portability across distros
SHELL := /bin/bash
.SHELLFLAGS := -eo pipefail -c

# Tool detection (using bash-specific &> redirect)
HAS_XGETTEXT := $(shell command -v xgettext &>/dev/null && echo yes || echo no)
HAS_MSGFMT := $(shell command -v msgfmt &>/dev/null && echo yes || echo no)

.PHONY: all clean install schemas uninstall enable disable log debug check-deps \
	dev prod build metadata potfile compilemsgs dist purge restart test test-x test-open \
	format lint unit-test unit-test-watch unit-test-coverage \
	docker-test-build unit-test-docker unit-test-docker-watch unit-test-docker-coverage \
	e2e-test e2e-test-fast e2e-test-all e2e-test-multimonitor e2e-test-record e2e-debug e2e-clean e2e-build e2e-versions \
	horizontal-line journal help

all: build install enable restart

dev: build debug install

prod: build install enable restart log

schemas: schemas/gschemas.compiled
	touch $@

schemas/gschemas.compiled: schemas/*.gschema.xml
	glib-compile-schemas schemas

metadata:
	@echo "Generating developer metadata..."
	@echo "export const developers = [" > lib/prefs/metadata.js
	@git shortlog -sne --all \
	| (grep -vE 'dependabot|noreply' || true) \
	| awk '{ \
		email = $$NF; \
		if (email in seen) next; \
		seen[email] = 1; \
		name = ""; \
		for (i = 2; i < NF; i++) { \
			name = name (i == 2 ? "" : " ") $$i; \
		} \
		gsub(/"/, "\\\"", name); \
		printf "  \"%s %s\",\n", name, email; \
	}' >> lib/prefs/metadata.js
	@echo "];" >> lib/prefs/metadata.js

build: clean metadata.json schemas compilemsgs metadata
	rm -rf temp
	mkdir -p temp
	cp metadata.json temp
	cp -r resources temp
	cp -r schemas temp
	cp -r config temp
	cp -r lib temp
	cp *.js temp
	cp *.css temp
	cp LICENSE temp
	mkdir -p temp/locale
	for msg in $(MSGSRC:.po=.mo); do \
		if [ -f $$msg ]; then \
			msgf=temp/locale/`basename $$msg .mo`; \
			mkdir -p $$msgf; \
			mkdir -p $$msgf/LC_MESSAGES; \
			cp $$msg $$msgf/LC_MESSAGES/forge.mo; \
		fi; \
	done;

./po/%.mo: ./po/%.po
	msgfmt -c $< -o $@

debug:
	sed -i 's/export const production = true/export const production = false/' temp/lib/shared/settings.js
	#sed -i 's|1.*-alpha|4999|' temp/metadata.json

potfile: ./po/forge.pot

# Conditional potfile generation based on xgettext availability
ifeq ($(HAS_XGETTEXT),yes)
./po/forge.pot: metadata ./prefs.js ./extension.js ./lib/**/*.js
	mkdir -p po
	xgettext --from-code=UTF-8 --output=po/forge.pot --package-name "Forge" ./prefs.js ./extension.js ./lib/**/*.js
else
./po/forge.pot:
	@echo "WARNING: xgettext not found, skipping pot file generation"
	@echo "Install gettext package for translation support"
	@mkdir -p po
	@touch ./po/forge.pot
endif

# Conditional compilation of messages based on msgfmt availability
ifeq ($(HAS_MSGFMT),yes)
compilemsgs: potfile $(MSGSRC:.po=.mo)
	for msg in $(MSGSRC); do \
		msgmerge -U $$msg ./po/forge.pot; \
	done;
else
compilemsgs:
	@echo "WARNING: msgfmt not found, skipping translation compilation"
	@echo "Install gettext package for translation support"
endif

clean:
	rm -f lib/prefs/metadata.js "$(UUID).zip"
	rm -rf temp schemas/gschemas.compiled

check-deps:
	@echo "Checking build dependencies..."
	@command -v glib-compile-schemas &>/dev/null || (echo "ERROR: glib-compile-schemas not found. Install glib2-devel or libglib2.0-dev" && exit 1)
	@command -v git &>/dev/null || (echo "ERROR: git not found" && exit 1)
	@command -v zip &>/dev/null || echo "WARNING: zip not found, 'make dist' will fail"
	@command -v xgettext &>/dev/null || echo "WARNING: xgettext not found, translations will be skipped"
	@command -v msgfmt &>/dev/null || echo "WARNING: msgfmt not found, translations will be skipped"
	@echo "All required dependencies found!"

enable:
	@if gnome-extensions list | grep -q "^$(UUID)$$"; then \
		gnome-extensions enable "$(UUID)" && echo "Extension enabled successfully"; \
	else \
		echo "WARNING: Extension not detected by GNOME Shell yet"; \
		echo "On Wayland: Log out and log back in, then run 'make enable'"; \
		echo "On X11: Press Alt+F2, type 'r', press Enter, then run 'make enable'"; \
	fi

disable:
	gnome-extensions disable "$(UUID)" || echo "Nothing to disable"

install:
	mkdir -p $(INSTALL_PATH)
	cp -r temp/* $(INSTALL_PATH)

uninstall:
	rm -rf $(INSTALL_PATH)

purge:
	rm -rf .config/forge

# When releasing
dist: build
	cd temp && \
	zip -qr "../${UUID}.zip" .

restart:
	if bash -c 'xprop -root &> /dev/null'; then \
		killall -HUP gnome-shell; \
	else \
		gnome-session-quit --logout; \
	fi

horizontal-line:
	@printf '%.s─' $$(seq 1 $$(tput cols)) && echo || true # Prints a line of dashes #

log: GNOME_SHELL_CMD=$(shell command -v gnome-shell)
log: horizontal-line
	@echo 'HINT: type [Ctrl]+[C] to return to the prompt.'
	journalctl --user --follow --output=short-iso --lines=10 --since='10 seconds ago' --grep 'warning|g_variant' "$(GNOME_SHELL_CMD)"

journal:
	journalctl -b 0 -r --since "1 hour ago"

test-nested: horizontal-line
	env GNOME_SHELL_SLOWDOWN_FACTOR=2 \
		MUTTER_DEBUG_DUMMY_MODE_SPECS=1500x1000 \
		MUTTER_DEBUG_DUMMY_MONITOR_SCALES=1 \
		GDK_BACKEND=wayland \
		WAYLAND_DISPLAY=wayland-forge \
		dbus-run-session -- gnome-shell --nested --wayland --wayland-display=wayland-forge

# Usage:
#   make test-open &
#   make test-open CMD=gnome-text-editor
#   make test-open CMD=gnome-terminal ARGS='--app-id app.x'
#   make test-open CMD=gnome-gnome-www-browser
#   make test-open CMD=firefox ARGS='--safe-mode' ENVVARS='MOZ_DBUS_REMOTE=1 MOZ_ENABLE_WAYLAND=1'
#
test-open: CMD=gnome-text-editor
test-open:
	GDK_BACKEND=wayland WAYLAND_DISPLAY=wayland-forge $(ENVVARS) $(CMD) $(ARGS)&

# When developing locally
test: disable uninstall clean build debug install enable test-nested

# X-Window testing need gnome-shell restart
test-x: disable uninstall purge build debug install enable restart log

format:
	npm run format

lint:
	npm run lint

# Unit tests (local with mocked GNOME APIs)
unit-test:
	npm test

unit-test-watch:
	npm run test:watch

unit-test-coverage:
	npm run test:coverage

# Docker-based testing (for CI or consistent environments)
docker-test-build:
	docker build -f Dockerfile.test -t forge-test .

unit-test-docker: docker-test-build
	docker run --rm forge-test npm test

unit-test-docker-watch: docker-test-build
	docker run --rm -it -v $(PWD):/app forge-test npm run test:watch

unit-test-docker-coverage: docker-test-build
	docker run --rm -v $(PWD)/coverage:/app/coverage forge-test npm run test:coverage

# E2E Testing (real GNOME Shell in containers)
# Uses Fedora base images; Fedora version determines GNOME version:
# Fedora 39 = GNOME 45, 40 = GNOME 46, 41 = GNOME 47,
# 42 = GNOME 48, 43 = GNOME 49, 44 = GNOME 50, rawhide = next devel cycle
SUPPORTED_FEDORA_VERSIONS := 39 40 41 42 43 44

# Map GNOME versions to Fedora versions for user convenience
# Usage: make e2e-test GNOME_VERSION=49  or  make e2e-test FEDORA_VERSION=43
ifdef GNOME_VERSION
  ifeq ($(GNOME_VERSION),45)
    FEDORA_VERSION := 39
  else ifeq ($(GNOME_VERSION),46)
    FEDORA_VERSION := 40
  else ifeq ($(GNOME_VERSION),47)
    FEDORA_VERSION := 41
  else ifeq ($(GNOME_VERSION),48)
    FEDORA_VERSION := 42
  else ifeq ($(GNOME_VERSION),49)
    FEDORA_VERSION := 43
  else ifeq ($(GNOME_VERSION),50)
    FEDORA_VERSION := 44
  else
    $(error Unknown GNOME_VERSION=$(GNOME_VERSION). Supported: 45, 46, 47, 48, 49, 50)
  endif
endif

# Default Fedora version for E2E tests (Fedora 42 = GNOME 48)
# Fedora 43 (GNOME 49) removed X11 support; headless Wayland mode is unstable.
FEDORA_VERSION ?= 42
E2E_IMAGE = forge-e2e-fedora$(FEDORA_VERSION)
E2E_RESULTS_DIR = e2e-results
DISPLAY_NUM ?= 99

# Docker capabilities for E2E containers
# --privileged is required for systemd to mount its filesystems
# --cgroupns=host and cgroup mount are needed for systemd cgroup support
# Container MUST run with systemd as PID 1 (detached mode)
E2E_DOCKER_OPTS = --privileged \
	--cgroupns=host \
	-v /sys/fs/cgroup:/sys/fs/cgroup:rw \
	-e container=docker

# Build E2E test container (builds extension first, then Docker image)
# RECORD=1 opts into the screencast recording stack (forge-qgg): installs
# pipewire/gstreamer in the image (build-arg gated, so RECORD-less builds are
# byte-identical) and passes FORGE_E2E_RECORD=1 into BOTH docker exec calls below.
RECORD_ENV = $(if $(RECORD),-e FORGE_E2E_RECORD=1,)

# Optional pytest marker expression threaded into run-tests.sh (mirrors RECORD_ENV).
# `make e2e-test PYTEST_MARKER=workflow` runs only the matching lane; empty = full suite.
# Single-word markers only at this layer (it expands unquoted into the docker exec
# line); for a multi-word expression like "not workflow" use pytest directly inside
# the container (`pytest -m "not workflow"`), as documented in tests/e2e/README.md.
MARKER_ENV = $(if $(PYTEST_MARKER),-e PYTEST_MARKER=$(PYTEST_MARKER),)

e2e-build: build
	docker build -f docker/Dockerfile.e2e -t $(E2E_IMAGE) \
		--build-arg FEDORA_VERSION=$(FEDORA_VERSION) \
		--build-arg ENABLE_RECORD=$(if $(RECORD),1,0) \
		--build-arg GIT_SHA=$$(git rev-parse HEAD 2>/dev/null || echo unknown) .

# Run E2E tests for a specific GNOME/Fedora version
# Usage: make e2e-test GNOME_VERSION=47  (or FEDORA_VERSION=41)
#
# This target runs the container in DETACHED mode with systemd as PID 1,
# then uses docker exec to run tests. This is required because:
# 1. GNOME Shell 45+ needs systemd-localed (org.freedesktop.locale1 D-Bus service)
# 2. The container uses systemd to manage core services
e2e-test: e2e-build
	@mkdir -p $(E2E_RESULTS_DIR)
	@echo "Starting E2E container in detached mode..."
	@POD=$$(docker run --rm -td $(E2E_DOCKER_OPTS) \
		-v $(PWD)/$(E2E_RESULTS_DIR):/app/e2e-results \
		$(E2E_IMAGE)) && \
	trap "echo 'Stopping container...'; docker stop $$POD 2>/dev/null || true" EXIT && \
	echo "Container: $$POD" && \
	echo "Waiting for container to initialize..." && \
	sleep 3 && \
	echo "Starting GNOME Shell session..." && \
	docker exec $(if $(MULTIMONITOR),-e FORGE_E2E_VIRTUAL_MONITORS=2,) $(RECORD_ENV) $$POD /usr/local/bin/start-user-session.sh $(DISPLAY_NUM) && \
	docker exec $$POD chown -R gnomeshell:gnomeshell /app/e2e-results && \
	echo "Running E2E tests..." && \
	docker exec --user gnomeshell -e DISPLAY=:$(DISPLAY_NUM) $(RECORD_ENV) $(MARKER_ENV) $$POD set-env.sh /app/scripts/run-tests.sh

# Run only the multi-step workflow lane (forge-911) — the fast inner-loop pass.
# The full suite still runs both lanes (workflows ordered first); this is for local
# iteration. GNOME_VERSION is forwardable, e.g. make e2e-test-fast GNOME_VERSION=48.
e2e-test-fast:
	@$(MAKE) e2e-test PYTEST_MARKER=workflow

# Run E2E tests with two virtual monitors (forge-a34.1, headless Wayland only).
# Boots the session with a second 1920x1080 output so test_multi_monitor runs;
# every other test is unaffected by the extra monitor.
e2e-test-multimonitor:
	@$(MAKE) e2e-test MULTIMONITOR=1

# Run E2E tests with screencast recording (forge-qgg). Wayland-only, so this
# forces the latest GNOME lane (F44/GNOME50; the default F42 lane is X11).
# Produces e2e-results/recording.webm. Recursive sub-make so GNOME_VERSION=50 ->
# FEDORA_VERSION:=44 -> E2E_IMAGE all resolve, and RECORD=1 reaches e2e-build
# (build-arg) plus both docker exec calls.
e2e-test-record:
	@$(MAKE) e2e-test GNOME_VERSION=50 RECORD=1

# Run E2E tests for all supported versions
e2e-test-all:
	@for version in $(SUPPORTED_FEDORA_VERSIONS); do \
		echo "========================================"; \
		echo "Running E2E tests for Fedora $$version..."; \
		echo "========================================"; \
		$(MAKE) e2e-test FEDORA_VERSION=$$version || echo "Fedora $$version tests failed"; \
	done

# Interactive debugging in E2E container
# Starts container with GNOME Shell, then drops into bash
e2e-debug: e2e-build
	@mkdir -p $(E2E_RESULTS_DIR)
	@echo "Starting E2E container for debugging..."
	@POD=$$(docker run --rm -td $(E2E_DOCKER_OPTS) \
		-v $(PWD)/tests/e2e:/app/tests/e2e \
		-v $(PWD)/$(E2E_RESULTS_DIR):/app/e2e-results \
		$(E2E_IMAGE)) && \
	trap "echo 'Stopping container...'; docker stop $$POD 2>/dev/null || true" EXIT && \
	echo "Container: $$POD" && \
	echo "Waiting for container to initialize..." && \
	sleep 3 && \
	echo "Starting GNOME Shell session..." && \
	docker exec $$POD /usr/local/bin/start-user-session.sh $(DISPLAY_NUM) && \
	docker exec $$POD chown -R gnomeshell:gnomeshell /app/e2e-results && \
	echo "" && \
	echo "========================================" && \
	echo "Debug shell ready. GNOME Shell is running." && \
	echo "Run tests with: python3 -m pytest tests/ -v" && \
	echo "========================================" && \
	docker exec -it --user gnomeshell -e DISPLAY=:$(DISPLAY_NUM) \
		-w /app/tests/e2e $$POD set-env.sh /bin/bash

# Clean E2E artifacts
e2e-clean:
	rm -rf $(E2E_RESULTS_DIR)
	@for version in $(SUPPORTED_FEDORA_VERSIONS); do \
		docker rmi forge-e2e-fedora$$version 2>/dev/null || true; \
	done

# List supported versions
e2e-versions:
	@echo "Supported GNOME versions:"
	@echo "  GNOME 45 (Fedora 39)"
	@echo "  GNOME 46 (Fedora 40)"
	@echo "  GNOME 47 (Fedora 41)"
	@echo "  GNOME 48 (Fedora 42)"
	@echo "  GNOME 49 (Fedora 43) - default"
	@echo "  GNOME 50 (Fedora rawhide) - alpha"
	@echo ""
	@echo "Usage:"
	@echo "  make e2e-test                    # Run with default (GNOME 49)"
	@echo "  make e2e-test GNOME_VERSION=48   # Run with GNOME 48"
	@echo "  make e2e-test GNOME_VERSION=50   # Run with GNOME 50 (rawhide)"
	@echo "  make e2e-test FEDORA_VERSION=42  # Run with Fedora 42 (GNOME 48)"
	@echo "  make e2e-test-all                # Run for all versions"
	@echo "  make e2e-debug                   # Interactive debugging"
	@echo ""
	@echo "Images are self-contained, built from Fedora base images."
	@echo "To test rawhide manually: make e2e-test GNOME_VERSION=50"

help:
	@echo "Forge GNOME Shell Extension - Build Targets"
	@echo ""
	@echo "Development:"
	@echo "  dev              Build in debug mode and install locally"
	@echo "  prod             Build, install, enable, and restart shell"
	@echo "  test             Build and test in nested Wayland session"
	@echo "  test-x           Build and test on X11 (restarts gnome-shell)"
	@echo "  test-open        Open an app in the nested test session"
	@echo "  log              Follow extension logs from journalctl"
	@echo ""
	@echo "Build:"
	@echo "  build            Compile extension (schemas, translations, metadata)"
	@echo "  clean            Remove build artifacts"
	@echo "  dist             Build distributable zip"
	@echo "  install          Install built extension to ~/.local/share/gnome-shell/extensions/"
	@echo "  uninstall        Remove installed extension"
	@echo "  check-deps       Verify build dependencies are installed"
	@echo ""
	@echo "Code Quality:"
	@echo "  format           Format code with Prettier (writes changes)"
	@echo "  lint             Check code formatting (no changes)"
	@echo ""
	@echo "Unit Tests:"
	@echo "  unit-test              Run tests locally"
	@echo "  unit-test-watch        Run tests in watch mode"
	@echo "  unit-test-coverage     Run tests with coverage report"
	@echo "  unit-test-docker       Run tests in Docker"
	@echo "  unit-test-docker-watch Run tests in Docker (watch mode)"
	@echo "  unit-test-docker-coverage  Run tests in Docker with coverage"
	@echo ""
	@echo "E2E Tests:"
	@echo "  e2e-test         Run E2E tests (default GNOME 49)"
	@echo "  e2e-test-all     Run E2E tests for all GNOME versions"
	@echo "  e2e-debug        Interactive debugging in E2E container"
	@echo "  e2e-clean        Remove E2E test artifacts and images"
	@echo "  e2e-versions     List supported GNOME versions"
	@echo ""
	@echo "GNOME Shell:"
	@echo "  enable           Enable the extension"
	@echo "  disable          Disable the extension"
	@echo "  restart          Restart GNOME Shell"
