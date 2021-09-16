# Electron Web MiniDisc

Electron version of [Web MiniDisc](https://github.com/cybercase/webminidisc)

For all the people who want to use all of Web Minidisc's features but don't want to use Google Chrome

### Building
The project consists of two parts:
- The main electron code
- The renderer (GUI) code (The Web MiniDisc project itself)

This repository contains only the main electron app.
Upon building, it will clone the renderer repository ([https://github.com/asivery/webminidisc](https://github.com/asivery/webminidisc)), and build that too.

You can:
- Start the development version (`npm start`)
- Deploy the production version (`npm run dist`)


Many thanks to [cybercase](https://github.com/cybercase) for writing the original Web MiniDisc and letting so may people experience this forgotten format.