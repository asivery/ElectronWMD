.PHONY: build ci


ci: build

build:
	git config --global url."https://github.com/".insteadOf git@github.com:
	git config --global url."https://".insteadOf ssh://	
	shell npm ci
	npm run dist
