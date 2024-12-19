const { contextBridge } = require('electron');
function findAndClickButton(query) {
    // Find the Play/Pause button using its ID or other attributes
    const button = document.querySelector(query);

    if (button) {
        button.click(); // Simulate a button click
        console.log(query + ' button clicked.');
    } else {
        console.error(query + ' button not found.');
    }
}
// Function to trigger a button press
function pressPlayButton() {
    // Find the Play/Pause button using its ID or other attributes
    findAndClickButton('.play-pause-button');
}

// Function to trigger the "Previous" button
function pressPreviousButton() {
    // Query the button by its class name
    findAndClickButton('.previous-button');
}

// Function to trigger the "Next" button
function pressNextButton() {
    // Query the button by its class name
    findAndClickButton('.next-button');
}
function isPlaying() {
    return document.querySelector('.play-pause-button')?.getAttribute('title') === 'Pause';
}
// Helper function to extract track details
function getCurrentTrackDetails() {
    const titleElement = document.querySelector('.title.ytmusic-player-bar');
    const bylineElement = document.querySelector('.byline.ytmusic-player-bar');

    const title = titleElement?.getAttribute('title') || 'Unknown Title';
    const artistAlbum = bylineElement?.getAttribute('title') || 'Unknown Artist';

    // Split artist and album (assuming " • " separates them)
    const [artist, album] = artistAlbum.split(' • ');

    const artworkElement = document.querySelector('#song-image img.yt-img-shadow');
    const artworkUrl = artworkElement?.src || 'default-artwork.png';

    return {
        title,
        artist: artist || 'Unknown Artist',
        album: album || 'Unknown Album',
        artwork: [
            {
                src: artworkUrl, sizes: '544x544', type: 'image/png'
            }
        ]
    };
}

navigator.mediaSession.setActionHandler('play', () => {
    window.controls.pressPlay();
});

navigator.mediaSession.setActionHandler('pause', () => {
    window.controls.pressPlay();
});

navigator.mediaSession.setActionHandler('previoustrack', () => {
    window.controls.pressPrevious();
});

navigator.mediaSession.setActionHandler('nexttrack', () => {
    window.controls.pressNext();
});
contextBridge.exposeInMainWorld('controls', {
    pressPlay: () => pressPlayButton(),
    pressPrevious: () => pressPreviousButton(),
    pressNext: () => pressNextButton(),
    isPlaying: () => isPlaying(),
    getCurrentTrackDetails: () => getCurrentTrackDetails(),
});
function updateMediaSessionMetadata() {
    const trackDetails = getCurrentTrackDetails();

    navigator.mediaSession.metadata = new MediaMetadata({
        title: trackDetails.title,
        artist: trackDetails.artist,
        album: trackDetails.album,
        artwork: trackDetails.artwork,
    });

    //console.log('Updated Media Session Metadata:', trackDetails);
}

// Periodically check for updates to track details
setInterval(updateMediaSessionMetadata, 1000); // Poll every second
