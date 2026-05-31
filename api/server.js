// v2
const express = require('express');
const handler = require('./poster');
const app = express();
app.use((req, res) => handler(req, res));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));