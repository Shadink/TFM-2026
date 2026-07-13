import * as lancedb from "@lancedb/lancedb";
import { pipeline } from '@xenova/transformers';

async function main() {
    // crear o abrir base de datos
    const db = await lancedb.connect("./rag-db");

    // abrir transformers
    const extractor = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2' // probar con Gemini
    );

    async function embed(text){
        const output = await extractor(text, {
            pooling: 'mean',
            normalize: true
        });
    
        return Array.from(output.data);

    }

    // abrir/crear tabla con embeddings
    let table;

    const vector = await embed("activar modo oscuro al ver noticias");
    const vector2 = await embed("activar modo oscuro al ver google")
    try {
        table = await db.openTable("adaptaciones");
    } catch {
        table = await db.createTable("adaptaciones", [
        {
            url: "elpais.com",
            accion: "modo oscuro",
            embedding: vector
        },
        {
            url: "periodico2.com",
            accion: "modo oscuro",
            embedding: vector
        },
        {
            url: "google.com",
            accion: "modo oscuro",
            embedding: vector2
        }
        ]);
    }

    console.log("Tabla lista");

    const queryVector = await embed("leer noticias de noche");

    const results = await table
    .search(queryVector)
    .limit(1)
    .toArray();

    console.log(results);

}

main();