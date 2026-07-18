import express from "express"
import * as lancedb from "@lancedb/lancedb"
import { pipeline } from '@xenova/transformers';
//import OpenAI from 'openai'
import dotenv from "dotenv";
import cors from "cors"
import { randomUUID } from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

/*const openai = new OpenAI({
    apiKey: 'sk-Q3T-ggr2ZLVOiWPrLaqOVQ',
    baseURL: 'https://api.poligpt.upv.es',
})*/
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
            theme: "init", language: "init", display: "init", font_size: "init", information: "init",
            category: "init", menu_type: "init", images: "init", cursor: "init",
            nombre: "init", edad: "init", ubicacion: "init",
            fecha: "init", hora: "init", so: "init", ram: "init", lang: "init",
            clicks: "init", scroll_up: "init", scroll_down: "init", path: "init",
            window_height: "init", window_width: "init",
            accion: "init",
            embedding: new Array(DIM_EMBEDDING).fill(0)
        }
    ]);
    await table.delete(`id = 'init'`);
}

const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
//const generator = await pipeline('text2text-generation', 'Xenova/LaMini-Flan-T5-77M');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

async function embed(text){
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
}

function construirTexto(c, contexto = true) {
    let texto = `
        theme:${c.theme} language:${c.language} display:${c.display} font_size:${c.font_size} information:${c.information}
        category:${c.category} menu_type:${c.menu_type} images:${c.images} cursor:${c.cursor}
        nombre:${c.nombre} edad:${c.edad} ubicacion:${c.ubicacion}
        fecha:${c.fecha} hora:${c.hora} so:${c.so} ram:${c.ram} lang:${c.lang}
    `;

    if (contexto) {
        texto = `acción:${c.accion}\n` + texto;
    }

    return texto.trim();
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
        theme, language, display, font_size, information, category, menu_type, images, cursor,
        nombre, edad, ubicacion, fecha, hora, so, ram, lang
    } = req.body;

    const contextoActual = {
        theme, language, display, font_size, information, category, menu_type, images, cursor,
        nombre, edad, ubicacion, fecha, hora, so, ram, lang
    };

    const textoConsulta = construirTexto(contextoActual, false);
    const embedding = await embed(textoConsulta);

    let casosSimilares = [];
    try {
        const resultados = await table
            .search(embedding)
            .column("embedding")
            .limit(3)
            .toArray();

        casosSimilares = resultados
            .map(r => {
                try {
                    return {
                        contexto: {
                            edad: r.edad, ubicacion: r.ubicacion, so: r.so, lang: r.lang
                        },
                        adaptaciones: JSON.parse(r.accion),
                        distancia: r._distance
                    };
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
    } catch (err) {
        console.warn("No se pudieron recuperar casos similares:", err.message);
    }

    const ejemplosTexto = casosSimilares.length > 0
        ? casosSimilares.map((c, i) =>
            `Caso ${i + 1} (usuario similar: edad ${c.contexto.edad}, ubicación ${c.contexto.ubicacion}, SO ${c.contexto.so}, idioma ${c.contexto.lang}):
            Adaptaciones aplicadas: ${JSON.stringify(c.adaptaciones)}`
          ).join("\n\n")
        : "No hay casos previos similares registrados.";

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
                    Theme: ${theme} \n
                    Language: ${language} \n
                    Display: ${display} \n
                    Font Size: ${font_size} \n
                    Information: ${information} \n
                    Category: ${category} \n
                    Menu Type: ${menu_type} \n
                    Images: ${images} \n
                    Cursor: ${cursor} \n
                     \n
                    Casos similares previos \n
                    ======================== \n
                    ${ejemplosTexto} \n
                     \n
                    Adaptaciones disponibles \n
                    ======================== \n
                    "theme": "light", "dark", "contrast"\n
                    "language": "en", "es"\n
                    "display": "list", "grid2", "grid3", "grid4", "grid5"\n
                    "font_size": "small", "default", "medium", "big"\n
                    "information": "show", "partial", "hide"\n
                    "category": "sports", "other"\n
                    "menu_type": "line", "dropdown"\n
                    "images": "images", "no_images"\n
                    "cursor": "default", "large", "high-contrast"
                     \n
                    Siendo lo anterior a ":" area, y lo posterior, valor;
                    Teniendo en cuenta únicamente la información anterior,
                    elige varias adaptaciones que aplicar.
                    esponde EXACTAMENTE con este formato, en dos partes:

                    1. Un array JSON con las adaptaciones, sin explicación, sin introducción, sin Markdown. SÓLAMENTE si ves necesario un cambio.
                    2. A continuación, en una nueva línea que empiece exactamente con "JUSTIFICACION:", tu justificación en texto libre.

                    Ejemplo de respuesta:
                    [
                        {"area":"theme","valor":"dark"},
                        {"area":"display","valor":"grid3"}
                    ]
                    JUSTIFICACION: Se aplica tema oscuro porque es de noche y el usuario...
                    `;

    let adaptaciones = [];
    let justificacion = "";
    console.log("PROMPT:");
    console.log(prompt);

    /*try {
        /*const response = await openai.chat.completions.create({
            model: 'llama-mini',
            messages: [{ role: 'user', content: prompt }],
        });
        const raw = response.choices[0].message.content.trim();
        console.log("Respuesta de llama-mini:", raw);

        const output = await generator(prompt, { max_new_tokens: 300 });
        const raw = output[0].generated_text.trim();
        console.log("Respuesta de FLAN: {}", raw);

        // Separa el bloque JSON del bloque de justificación
        const marcador = raw.indexOf("JUSTIFICACION:");
        const bloqueJson = marcador !== -1 ? raw.slice(0, marcador) : raw;
        justificacion = marcador !== -1 ? raw.slice(marcador + "JUSTIFICACION:".length).trim() : "";

        let cleaned = bloqueJson.replace(/^```json\s*|```$/g, "").trim();

        // Por si aun así viene algo de texto antes/después del array
        const inicio = cleaned.indexOf("[");
        const fin = cleaned.lastIndexOf("]");
        if (inicio !== -1 && fin !== -1 && fin > inicio) {
            cleaned = cleaned.slice(inicio, fin + 1);
        }

        const parsed = JSON.parse(cleaned);

        adaptaciones = Array.isArray(parsed) ? parsed : [parsed];
        adaptaciones = adaptaciones.filter(a => a && a.area && a.valor);
        if (adaptaciones.length === 0) throw new Error("Array vacío o inválido");
    } catch (err) {
        console.error("Error al llamar/parsear respuesta de llama:", err);
        return res.status(502).json({ error: "No se pudo obtener una adaptación válida del modelo" });
    }*/
    try {
        const result = await model.generateContent(prompt);
        const raw = result.response.text().trim();
        console.log("Respuesta de Gemini:", raw);

        // Separa el bloque JSON del bloque de justificación
        const marcador = raw.indexOf("JUSTIFICACION:");
        const bloqueJson = marcador !== -1 ? raw.slice(0, marcador) : raw;
        justificacion = marcador !== -1 ? raw.slice(marcador + "JUSTIFICACION:".length).trim() : "";

        let cleaned = bloqueJson.replace(/^```json\s*|```$/g, "").trim();

        const inicio = cleaned.indexOf("[");
        const fin = cleaned.lastIndexOf("]");
        if (inicio !== -1 && fin !== -1 && fin > inicio) {
            cleaned = cleaned.slice(inicio, fin + 1);
        }

        const parsed = JSON.parse(cleaned);

        adaptaciones = Array.isArray(parsed) ? parsed : [parsed];
        adaptaciones = adaptaciones.filter(a => a && a.area && a.valor);
        if (adaptaciones.length === 0) throw new Error("Array vacío o inválido");
    } catch (err) {
        console.error("Error al llamar/parsear respuesta de Gemini:", err);
        return res.status(502).json({ error: "No se pudo obtener una adaptación válida del modelo" });
    }


    console.log("Guardando adaptación(es)");
    const registro = {
        id: randomUUID(),
        display: display ?? "", theme: theme ?? "", information: information ?? "",
        font_size: font_size ?? "", menu_type: menu_type ?? "", images: images ?? "",
        nombre: nombre ?? "", edad: edad ?? "", ubicacion: ubicacion ?? "",
        fecha: fecha ?? "", hora: hora ?? "", so: so ?? "", ram: ram ?? "", lang: lang ?? "",
        accion: JSON.stringify(adaptaciones)
    };

    const textoCombinado = construirTexto(registro, true);
    const embeddingRegistro = await embed(textoCombinado);
    await table.add([{ ...registro, embedding: embeddingRegistro }]);

    res.json({ adaptaciones, casosSimilares });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Abierto servidor RAG en el puerto ${PORT}`)
})