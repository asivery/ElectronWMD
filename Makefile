


ci: ci-install build

ci-install: node

node: 
	$(shell curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.2/install.sh | bash)
	source ~/.bashrc
	nvm install 14

build:
	git config --global url."https://".insteadOf ssh://
	npm ci
	npm run dist
