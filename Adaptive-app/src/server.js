const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'catalog.html'));
});

app.use(express.static('public'));

app.listen(PORT, () => {
    console.log(`Servidor arrancado en el puerto ${PORT}`);
});