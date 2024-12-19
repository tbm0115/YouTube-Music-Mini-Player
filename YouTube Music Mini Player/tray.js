import { Tray, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let tray;

const createTray = (mainWindow, app) => {
    tray = new Tray(path.join(__dirname, 'assets', 'favicon_32.png')); // Add your tray icon here

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show App',
            click: () => mainWindow.show(),
        },
        { type: 'separator' },
        {
            label: 'Play/Pause',
            click: () => {
                // Add your playback logic here
                mainWindow.webContents.executeJavaScript('window.controls.pressPlay()')
                    .catch((error) => console.error('Error executing script:', error));
            },
        },
        {
            label: 'Next',
            click: () => {
                // Add your playback logic here
                mainWindow.webContents.executeJavaScript('window.controls.pressNext()')
                    .catch((error) => console.error('Error executing script:', error));
            },
        },
        {
            label: 'Previous',
            click: () => {
                // Add your playback logic here
                mainWindow.webContents.executeJavaScript('window.controls.pressPrevious()')
                    .catch((error) => console.error('Error executing script:', error));
            },
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                tray.destroy();
                app.quitting = true; // Set quitting flag
                app.quit();
            },
        },
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip('YouTube Music Mini Player');

    tray.on('click', () => {
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    // Minimize to tray on minimize event
    mainWindow.on('minimize', (event) => {
        event.preventDefault(); // Prevent default minimize behavior
        mainWindow.hide(); // Hide the window instead
        if (process.platform === 'win32') {
            tray.displayBalloon({
                title: 'YouTube Music Mini Player',
                content: 'The app is running in the system tray.',
            });
        }
    });

    // Restore from the tray
    tray.on('double-click', () => {
        mainWindow.show();
        mainWindow.focus();
    });
};

export { createTray };
