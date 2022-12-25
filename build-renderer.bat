if exist renderer\ (
	echo Renderer is present. It won't be rebuilt
	exit
)

rd /S /Q webminidisc

git clone https://github.com/asivery/webminidisc
cd webminidisc
npm i
set PUBLIC_URL="sandbox://"
npm run build
rd /S /Q ..\renderer
xcopy /E build ..\renderer
cd ..


