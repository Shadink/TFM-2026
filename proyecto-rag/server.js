import express from "express"
import * as lancedb from "@lancedb/lancedb"
import { pipeline } from '@xenova/transformers';
import OpenAI from 'openai'
import dotenv from "dotenv";
import cors from "cors"
import { randomUUID } from "crypto";
dotenv.config();

const openai = new OpenAI({
    apiKey: 'sk-Q3T-ggr2ZLVOiWPrLaqOVQ',
    baseURL: 'https://api.poligpt.upv.es',
})
const app = express()
app.use(express.json())

// ===== GESTIÓN DE LA TABLA RAG =====
const dbConn = await lancedb.connect("./rag-db");
const NOMBRE_TABLA = "adaptaciones";
const DIM_EMBEDDING = 384; // all-MiniLM-L6-v2

const tablasExistentes = await dbConn.tableNames();
let table;

if (tablasExistentes.includes(NOMBRE_TABLA)) {
    console.log(`Tabla "${NOMBRE_TABLA}" ya existe. Abriendo...`);
    table = await dbConn.openTable(NOMBRE_TABLA);
} else {
    console.log(`Tabla "${NOMBRE_TABLA}" no existe. Creando...`);
    table = await dbConn.createTable(NOMBRE_TABLA, [
        {
            id: "init",
            display: "init", theme: "init", information: "init",
            font_size: "init", menu_type: "init", images: "init",
            nombre: "init", edad: "init", ubicacion: "init",
            fecha: "init", hora: "init", so: "init", ram: "init", lang: "init",
            clicks: "init", scroll_up: "init", scroll_down: "init", path: "init",
            window_height: "init", window_width: "init",
            adaptacion_aplicada: "init",
            embedding: new Array(DIM_EMBEDDING).fill(0)
        }
    ]);
    await table.delete(`id = 'init'`);
}

const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

async function embed(text){
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
}

function construirTexto(c) {
    return `
        acción:${c.accion}
        display:${c.display} theme:${c.theme} information:${c.information}
        font_size:${c.font_size} menu_type:${c.menu_type} images:${c.images}
        nombre:${c.nombre} edad:${c.edad} ubicacion:${c.ubicacion}
        fecha:${c.fecha} hora:${c.hora} so:${c.so} ram:${c.ram} lang:${c.lang}
    `.trim();
}

app.use(cors({ origin: "*" }))

app.post("/llama", async (req, res) => {
    const { name } = req.body;
    const prompt = `El usuario se llama: ${name}. Salúdale y dile algo útil.`;
    const response = await openai.chat.completions.create({
        model: 'llama-mini',
        messages: [
            {
                role: 'user',
                content: prompt
            }
        ],
    })
    console.log("Hablando con llama: ", prompt);
    res.json({ respuesta: response.choices[0].message.content });
});

app.post("/adapt", async (req, res) => {

    console.log("HEADERS:");
    console.log(req.headers);

    console.log("BODY:");
    console.log(req.body);
    const {
        display, theme, information, font_size, menu_type, images,
        nombre, edad, ubicacion, fecha, hora, so, ram, lang
    } = req.body;

    const prompt = `Datos del usuario \n
                    =============== \n
                    Nombre: ${nombre} \n
                    Edad: ${edad} \n
                    Ubicación: ${ubicacion} \n
                    Fecha: ${fecha} \n
                    Hora: ${hora} \n
                    Sistema Operativo: ${so} \n
                    RAM: ${ram}MB \n
                    Idioma: ${lang} \n
                     \n
                    Interfaz actual \n
                    =============== \n
                    Display: ${display} \n
                    Theme: ${theme} \n
                    Information: ${information} \n
                    Font Size: ${font_size} \n
                    Menu Type: ${menu_type} \n
                    Images: ${images} \n
                     \n
                    Adaptaciones disponibles \n
                    ======================== \n
                    "display": "list", "grid2", "grid3", "grid4", "grid5"\n
                    "theme": "light", "dark", "contrast"\n
                    "information": "show", "partial", "hide"\n
                    "font_size": "small", "default", "medium", "big"\n
                    "menu_type": "line", "dropdown"\n
                    "images": "images", "no_images"\n
                     \n

                    Siendo lo anterior a ":" area, y lo posterior, valor
                    Teniendo en cuenta únicamente la información anterior,
                    elige varias adaptaciones que aplicar.

                    Tu respuesta debe ser exclusivamente un objeto JSON.

                    No escribas ninguna explicación.

                    No escribas introducciones.

                    No utilices Markdown.

                    Ejemplo de respuesta:

                    [
                        {"area":"theme","valor":"dark"},
                        {"area":"display","valor":"grid3"}
                    ]
                    `;

    let accion, valor;
    let adaptaciones = [];
    try {
        const response = await openai.chat.completions.create({
            model: 'llama-mini',
            messages: [{ role: 'user', content: prompt }],
        });
        const raw = response.choices[0].message.content.trim();
        const cleaned = raw.replace(/^```json\s*|```$/g, "").trim();
        const parsed = JSON.parse(cleaned);
        console.log("Respuesta de llama-mini: {}", raw);

        adaptaciones = Array.isArray(parsed) ? parsed : [parsed];

        adaptaciones = adaptaciones.filter(a => a && a.area && a.valor);
        if (adaptaciones.length === 0) throw new Error("Array vacío o inválido");
    } catch (err) {
        console.error("Error al llamar/parsear respuesta de llama:", err);
        return res.status(502).json({ error: "No se pudo obtener una adaptación válida del modelo" });
    }

    console.log("Guardando adaptación(es)");
    const registro = {
        id: randomUUID(),
        display: display ?? "", theme: theme ?? "", information: information ?? "",
        font_size: font_size ?? "", menu_type: menu_type ?? "", images: images ?? "",
        nombre: nombre ?? "", edad: edad ?? "", ubicacion: ubicacion ?? "",
        fecha: fecha ?? "", hora: hora ?? "", so: so ?? "", ram: ram ?? "", lang: lang ?? "",
        adaptacion_aplicada: JSON.stringify(adaptaciones)
    };

    const textoCombinado = construirTexto(registro);
    const embedding = await embed(textoCombinado);
    await table.add([{ ...registro, embedding }]);

    const results = await table
        .search(embedding)
        .column("embedding")
        .limit(1)
        .toArray();

    console.log("Resultado: ", results);
    res.json({ adaptaciones, tabla: results });
});

app.listen(3000, () => {
    console.log("Abierto servidor RAG en http://localhost:3000")
})