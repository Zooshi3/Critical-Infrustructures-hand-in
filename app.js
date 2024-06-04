const express = require('express');
const axios = require('axios');
const querystring = require('querystring');
const path = require('path');
const session = require('express-session');

const app = express();
const port = 8888;

const client_id = 'b6ceac8cdfca4961899ec10abd0c1168'; // Replace with your actual client ID
const client_secret = '78387c1db0b84674b810fd5791f7a9a3'; // Replace with your actual client secret
const redirect_uri = 'http://localhost:8888/callback'; // Ensure this matches your registered redirect URI

// Configure session middleware
app.use(session({
  secret: 'your_secret_key', // Replace with a strong secret key
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
}));

// Serve index.html file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
  const scopes = 'user-library-read user-library-modify user-read-recently-played';
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id,
      scope: scopes,
      redirect_uri: redirect_uri
    }));
});

app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  const authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    method: 'post',
    data: querystring.stringify({
      code: code,
      redirect_uri: redirect_uri,
      grant_type: 'authorization_code'
    }),
    headers: {
      'Authorization': 'Basic ' + (Buffer.from(client_id + ':' + client_secret).toString('base64')),
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  };

  try {
    const response = await axios(authOptions);
    req.session.access_token = response.data.access_token; // Store access token in session

    // Fetch user's saved albums
    const savedAlbumsResponse = await axios.get('https://api.spotify.com/v1/me/albums', {
      headers: {
        'Authorization': 'Bearer ' + req.session.access_token
      }
    });
    const savedAlbums = savedAlbumsResponse.data.items;

    // Fetch user's recently played tracks
    const recentlyPlayedResponse = await axios.get('https://api.spotify.com/v1/me/player/recently-played', {
      headers: {
        'Authorization': 'Bearer ' + req.session.access_token
      }
    });
    const recentlyPlayedTracks = recentlyPlayedResponse.data.items;

    // Calculate the threshold date (e.g., 6 months ago)
    const thresholdDate = new Date();
    thresholdDate.setMonth(thresholdDate.getMonth() - 6);

    // Identify albums that were not recently played and were added before the threshold date
    const lostGems = savedAlbums.filter(album => {
      const albumTracks = album.album.tracks.items.map(track => track.id);
      const addedDate = new Date(album.added_at);
      return addedDate < thresholdDate && !recentlyPlayedTracks.some(play => albumTracks.includes(play.track.id));
    });

    // Serve the HTML file with embedded data
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Spotify Lost Gems</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #1d1d27;
            color: #333;
            text-align: center;
            padding: 20px;
          }
          .container {
            max-width: 800px;
            margin: auto;
            background: #eae9ec;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
          }
          h1 {
            color: #1DB954;
          }
          .album {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
          }
          .album img {
            width: 100px;
            height: 100px;
            object-fit: cover;
            border-radius: 10px;
            margin-right: 20px;
          }
          .album-info {
            text-align: left;
            flex-grow: 1;
          }
          .album-info h2 {
            margin: 0;
            font-size: 1.2em;
          }
          .album-info p {
            margin: 5px 0;
          }
          .login-btn, .remove-btn, .logout-btn {
            display: inline-block;
            padding: 10px 20px;
            background-color: #1DB954;
            color: #fff;
            border: none;
            border-radius: 50px;
            text-decoration: none;
            font-size: 1em;
            transition: background-color 0.3s;
            cursor: pointer;
          }
          .login-btn:hover, .remove-btn:hover, .logout-btn:hover {
            background-color: #17a744;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Spotify Lost Gems</h1>
          <div id="results">
            ${lostGems.map(album => `
              <div class="album">
                <img src="${album.album.images[0].url}" alt="${album.album.name}">
                <div class="album-info">
                  <h2>${album.album.name}</h2>
                  <p>by ${album.album.artists.map(artist => artist.name).join(', ')}</p>
                  <p>Saved at: ${new Date(album.added_at).toLocaleDateString()}</p>
                </div>
                <button class="remove-btn" onclick="removeAlbum('${album.album.id}')">Remove</button>
              </div>
            `).join('')}
          </div>
          <button class="logout-btn" onclick="logout()">Log Out</button>
        </div>
        <script>
          async function removeAlbum(albumId) {
            const response = await fetch('/remove-album?album_id=' + albumId, {
              method: 'DELETE'
            });
            if (response.ok) {
              alert('Album removed successfully');
              location.reload();
            } else {
              alert('Failed to remove album');
            }
          }
          function logout() {
            window.location.href = '/logout';
          }
        </script>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('Error during authentication:', error.response ? error.response.data : error.message);
    res.send(error.response ? error.response.data : error.message);
  }
});

app.delete('/remove-album', async (req, res) => {
  const albumId = req.query.album_id;
  const removeAlbumOptions = {
    url: `https://api.spotify.com/v1/me/albums?ids=${albumId}`,
    method: 'DELETE',
    headers: {
      'Authorization': 'Bearer ' + req.session.access_token,
      'Content-Type': 'application/json'
    }
  };

  try {
    await axios(removeAlbumOptions);
    res.status(200).send('Album removed successfully');
  } catch (error) {
    console.error('Error removing album:', error.response ? error.response.data : error.message);
    res.status(500).send(error.response ? error.response.data : error.message);
  }
});

app.get('/logout', (req, res) => {
  console.log("Logout route accessed");
  req.session.destroy(err => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    res.clearCookie('connect.sid'); // Ensure session cookie is cleared
    res.redirect('/login'); // Redirect to the login page after logout
  });
});



app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`);
});