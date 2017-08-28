rfind = $(shell find '$(1)' -name '$(2)')

# TODO add this back in: Makefile 
SRC_FILES := src/index.ts \
	$(call rfind,src,[^.]*.ts) \
	$(call rfind,src,[^.]*.js) \
	$(call rfind,src,[^.]*.json)

EXAMPLE_FILES = $(shell find examples/ -type f)

PREREQS_STATEFILE = .make/done_prereqs
DEPS_STATEFILE = .make/done_deps
TESTS_STATEFILE = .make/done_tests
DOCKER_STATEFILE = .make/done_docker
BUILD_ARTIFACTS = dist/iidy-macos dist/iidy-linux

##########################################################################################
## Top level targets. Our public api. See Plumbing section for the actual work
.PHONY : prereqs deps build docker_build test clean fullclean release

.DEFAULT_GOAL := build

prereqs : $(PREREQS_STATEFILE)

deps : $(DEPS_STATEFILE)

build : $(BUILD_ARTIFACTS)

docker_build : $(DOCKER_STATEFILE)

test : $(TESTS_STATEFILE)

# TODO script version bump & upload of the binaries
#release: check_working_dir_is_clean clean deps build test

clean :
	rm -rf dist/*

fullclean : clean
	rm -rf .make node_modules


################################################################################
## Plumbing

$(PREREQS_STATEFILE) :
	@mkdir -p .make
	@echo '>>>' Checking that you have required system level dependencies
	@echo https://nodejs.org/en/
	@which node
	@touch $(PREREQS_STATEFILE)

$(DEPS_STATEFILE) : $(PREREQS_STATEFILE) package.json
	@mkdir -p .make
	npm install
	@touch $(DEPS_STATEFILE)

# TODO add intermediate pre-binaries build target and associated tests

$(BUILD_ARTIFACTS) : $(DEPS_STATEFILE) $(SRC_FILES)
	npm run build
	npm run pkg-binaries


# TODO expand this
$(TESTS_STATEFILE) : $(BUILD_ARTIFACTS) $(EXAMPLE_FILES)
# initial sanity checks:
	bin/iidy help | grep argsfile > /dev/null
ifeq ($(shell uname),Darwin)
	dist/iidy-macos help | grep argsfile > /dev/null
endif
# functional tests:
	mkdir -p dist/docker/
	cp dist/iidy-linux dist/docker/iidy
	cp Dockerfile.test dist/docker/Dockerfile
	cp Makefile.test dist/docker/Makefile
	cp -a examples dist/docker/
	docker build -t iidy-test dist/docker
	docker run --rm -it -v ~/.aws/:/root/.aws/ iidy-test make test
	touch $(TESTS_STATEFILE)

$(DOCKER_STATEFILE): $(BUILD_ARTIFACTS) $(EXAMPLE_FILES)
	@rm -rf /tmp/iidy
	@git clone . /tmp/iidy

	docker build -t iidy -f /tmp/iidy/Dockerfile /tmp/iidy
	docker run -it --rm iidy help > /dev/null

	docker build -t iidy-yarn -f /tmp/iidy/Dockerfile.test-yarn-build /tmp/iidy
	docker run -it --rm iidy-yarn help > /dev/null
	docker rmi iidy-yarn

	docker build -t iidy-npm -f /tmp/iidy/Dockerfile.test-npm-build /tmp/iidy
	docker run -it --rm iidy-npm help  > /dev/null
	docker rmi iidy-npm

	@rm -rf /tmp/iidy


check_working_dir_is_clean :
	git diff --quiet --ignore-submodules HEAD
