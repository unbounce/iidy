rfind = $(shell find '$(1)' -name '$(2)')

# TODO add this back in: Makefile
SRC_FILES := $(call rfind,src,[^.]*.ts) \
		$(call rfind,src,[^.]*.js) \
		$(call rfind,src,[^.]*.json)

EXAMPLE_FILES = $(shell find examples/ -type f)

PREREQS_STATEFILE = .make/done_prereqs
DEPS_STATEFILE = .make/done_deps
TESTS_STATEFILE = .make/done_tests
DOCKER_STATEFILE = .make/done_docker
BUILD_ARTIFACTS = dist/iidy-macos-x64 dist/iidy-macos-arm64 dist/iidy-linux-x64 dist/iidy-linux-arm64
RELEASE_PACKAGES = dist/iidy-macos-amd64.zip dist/iidy-macos-arm64.zip dist/iidy-linux-amd64.zip dist/iidy-linux-arm64.zip
# pkg arch name of the build host, used to pick the binaries the tests run
HOST_ARCH := $(if $(filter arm64 aarch64,$(shell uname -m)),arm64,x64)

DOCKER_BUILD_ARGS = --force-rm
##########################################################################################
## Top level targets. Our public api. See Plumbing section for the actual work
.PHONY : prereqs deps build docker_build test clean fullclean package prepare_release help

help: ## Display this message
	@grep -E '^[a-zA-Z_-]+ *:.*?## .*$$' $(MAKEFILE_LIST) \
	| awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'
.DEFAULT_GOAL := help

prereqs : $(PREREQS_STATEFILE)    ## Check for system level prerequisites

deps : $(DEPS_STATEFILE)          ## Install library deps (e.g. npm install)

build : $(BUILD_ARTIFACTS)        ## Build static binaries

docker_build : $(DOCKER_STATEFILE) ## Build and test docker images

test : $(TESTS_STATEFILE)		## Run functional tests

clean :								## Clean the dist/ directory (binaries, etc.)
	rm -rf dist/* lib/*

fullclean : clean ## Clean dist, node_modules and .make (make state tracking)
	rm -rf .make node_modules

package: SHELL:=/bin/bash
package: $(RELEASE_PACKAGES)
	@git diff --quiet --ignore-submodules HEAD || echo -e '\x1b[0;31mWARNING: git workding dir not clean\x1b[0m'
	@echo
	@ls -alh dist/*zip
	@shasum --UNIVERSAL -a 256 dist/* || true
	@echo
	@echo open dist/

changelog:
	@./bin/gen-changelog.sh

prepare_release :  ## Prepare a new public release. Requires clean git workdir
	./bin/assert-good-state-for-release
	make clean
	make test
	make package
	@echo update https://github.com/unbounce/iidy/releases
	@echo and remember to update https://github.com/unbounce/homebrew-taps/blob/master/iidy.rb

# TODO script version bump & upload of the binaries
#release: check_working_dir_is_clean clean deps build test

################################################################################
## Plumbing

$(PREREQS_STATEFILE) :
	@mkdir -p .make
	@echo '>>>' Checking that you have required system level dependencies
	@echo https://nodejs.org/en/
	@which node
	@touch $(PREREQS_STATEFILE)

$(DEPS_STATEFILE) : Makefile $(PREREQS_STATEFILE) package.json
	@mkdir -p .make
	npm install
	@touch $(DEPS_STATEFILE)

# TODO add intermediate pre-binaries build target and associated tests

$(BUILD_ARTIFACTS) : $(DEPS_STATEFILE) $(SRC_FILES)
	npm run build
	npm test
	bin/iidy help | grep argsfile > /dev/null
	npm run pkg-binaries

$(RELEASE_PACKAGES) : $(BUILD_ARTIFACTS)
	cd dist && \
	for OS in linux macos; do \
		cp iidy-$$OS-x64 iidy-$$OS-amd64; \
		for ARCH in amd64 arm64; do \
			cp iidy-$$OS-$$ARCH iidy; \
			zip iidy-$${OS}-$${ARCH}.zip iidy;\
			shasum --UNIVERSAL -a 256 iidy-$${OS}-$${ARCH}.zip; \
		done; \
	done
	rm -f dist/iidy

$(TESTS_STATEFILE) : $(BUILD_ARTIFACTS) $(EXAMPLE_FILES)
# initial sanity checks:
ifeq ($(shell uname),Darwin)
	dist/iidy-macos-$(HOST_ARCH) help | grep argsfile > /dev/null
endif
# functional tests:
	mkdir -p dist/docker/
	cp dist/iidy-linux-$(HOST_ARCH) dist/docker/iidy
	cp Dockerfile.test dist/docker/Dockerfile
	cp Makefile.test dist/docker/Makefile
	cp -a examples dist/docker/
	docker build $(DOCKER_BUILD_ARGS) -t iidy-test dist/docker
	bash -c 'docker run --env-file=<(env | grep AWS) --rm -it -v ~/.aws/:/root/.aws/ iidy-test make test'
#	^ bash -c required due to <() redirection not working with Make directly
	touch $(TESTS_STATEFILE)

$(DOCKER_STATEFILE) : $(BUILD_ARTIFACTS) $(EXAMPLE_FILES)
	@rm -rf /tmp/iidy
	@git clone . /tmp/iidy

	docker build $(DOCKER_BUILD_ARGS) -t iidy-npm -f /tmp/iidy/Dockerfile.test-npm-build /tmp/iidy
	sleep 0.5
	docker run -it --rm iidy-npm help  > /dev/null
	docker rmi iidy-npm

	docker build $(DOCKER_BUILD_ARGS) -t iidy -f /tmp/iidy/Dockerfile /tmp/iidy
	sleep 0.5
	docker run -it --rm iidy help > /dev/null

	@rm -rf /tmp/iidy
