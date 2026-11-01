const fs = require("fs");
const https = require("https");
const http = require("http");

const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const regras = JSON.parse(fs.readFileSync("regras.json", "utf8"));

const fontes = config.fontes.filter(fonte => fonte.ativo === true);
const candidatos = [];

const termosLocais = [
    "núcleo bandeirante", "nucleo bandeirante", "guará", "guara",
    "candangolândia", "candangolandia", "riacho fundo", "samambaia",
    "park way", "brasília", "brasilia", "distrito federal", "df"
];

const termosPoliticos = [
    "eleição", "eleicoes", "eleições", "candidato", "candidata",
    "campanha eleitoral", "propaganda eleitoral", "partido político",
    "partido politico", "sabatina", "disputa partidária", "disputa partidaria"
];

const termosIgnorados = [
    "/login", "/entrar", "/cadastro", "/search", "/busca", "/buscar",
    "/tag/", "/tags/", "/categoria/", "/categorias/", "/author/",
    "/autor/", "/perfil/", "/contato", "/sobre", "/publicidade",
    "/newsletter", "facebook.com", "instagram.com", "youtube.com",
    "twitter.com", "linkedin.com", "whatsapp.com"
];

function baixar(url) {
    return new Promise((resolve, reject) => {
        const cliente = url.startsWith("https://") ? https : http;
        const requisicao = cliente.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 RADAR-AGORA/2.0",
                "Accept": "text/html,application/xhtml+xml"
            }
        }, resposta => {
            let dados = "";
            resposta.setEncoding("utf8");
            resposta.on("data", parte => { dados += parte; });
            resposta.on("end", () => {
                if (resposta.statusCode >= 200 && resposta.statusCode < 400) {
                    resolve(dados);
                } else {
                    reject(new Error("HTTP " + resposta.statusCode));
                }
            });
        });

        requisicao.setTimeout(20000, () => {
            requisicao.destroy(new Error("Tempo limite excedido"));
        });
        requisicao.on("error", reject);
    });
}

function limparTexto(texto) {
    return texto
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#(\d+);/g, (_, codigo) => String.fromCharCode(Number(codigo)))
        .replace(/&#x([0-9a-f]+);/gi, (_, codigo) => String.fromCharCode(parseInt(codigo, 16)))
        .replace(/\s+/g, " ")
        .trim();
}

function urlAbsoluta(url, origem) {
    try {
        const destino = new URL(url, origem);
        if (destino.protocol !== "http:" && destino.protocol !== "https:") return "";
        destino.hash = "";
        return destino.href;
    } catch {
        return "";
    }
}

function parecePublicacao(url, titulo, fonte) {
    if (!url || !titulo || titulo.length < 28 || titulo.length > 220) return false;
    if (!/^https?:\/\//i.test(url)) return false;

    const texto = (url + " " + titulo).toLowerCase();
    if (termosIgnorados.some(item => texto.includes(item))) return false;

    try {
        const origem = new URL(fonte.url);
        const destino = new URL(url);
        if (destino.hostname === origem.hostname && destino.pathname.replace(/\/$/, "") === origem.pathname.replace(/\/$/, "")) {
            return false;
        }
    } catch {
        return false;
    }

    if (regras.links.permitir_homepage === false && new URL(url).pathname.replace(/\/$/, "") === "") return false;
    return true;
}

function extrairHTML(html, fonte) {
    const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];

    for (const item of links) {
        const url = urlAbsoluta(item[1], fonte.url);
        const titulo = limparTexto(item[2]);

        if (!parecePublicacao(url, titulo, fonte)) continue;

        candidatos.push({
            title: titulo,
            url: url,
            source: fonte.nome
        });
    }
}

async function coletarFontes() {
    console.log("=== COLETA AUTÔNOMA ===");
    console.log("Fontes ativas: " + fontes.length);

    for (const fonte of fontes) {
        console.log("Fonte: " + fonte.nome);
        try {
            const html = await baixar(fonte.url);
            const antes = candidatos.length;
            extrairHTML(html, fonte);
            console.log("OK — " + (candidatos.length - antes) + " candidatos");
        } catch (erro) {
            console.log("ERRO: " + erro.message);
        }
    }
}

function removerDuplicados(itens) {
    const mapa = new Map();
    for (const item of itens) {
        const chave = item.url.replace(/\/$/, "").toLowerCase();
        if (!mapa.has(chave)) mapa.set(chave, item);
    }
    return [...mapa.values()];
}

function normalizar(texto) {
    return texto.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ").trim();
}

function classificar(item) {
    const texto = normalizar(item.title + " " + item.url);

    if (/\b(vaga|emprego|contratacao|processo seletivo|concurso)\b/.test(texto)) return "vaga";
    if (/\b(evento|festival|show|espetaculo|exposicao|programacao|ingresso|inscricoes)\b/.test(texto)) return "evento";
    if (/\b(oferta|promocao|desconto|liquidacao)\b/.test(texto)) return "oferta";
    if (/\b(como fazer|aprenda|dica|receita|guia)\b/.test(texto)) return "dica";
    if (/\b(hoje|amanha|fim de semana|neste domingo|neste sabado)\b/.test(texto)) return "atualidade";
    return "noticia";
}

function pontuar(item) {
    const titulo = normalizar(item.title);
    const url = normalizar(item.url);
    const texto = titulo + " " + url;
    let pontos = 0;

    const locaisEncontrados = termosLocais.filter(termo => texto.includes(normalizar(termo)));
    if (locaisEncontrados.length) pontos += 8 + Math.min(locaisEncontrados.length, 3) * 2;

    const fonte = normalizar(item.source);
    if (fonte.includes("nucleo bandeirante")) pontos += 12;
    else if (fonte.includes("brasilia") || fonte.includes("distrito federal") || fonte.includes("cultural")) pontos += 6;

    if (termosPoliticos.some(termo => texto.includes(normalizar(termo)))) pontos -= 18;

    const tipo = classificar(item);
    if (tipo === "vaga" || tipo === "evento" || tipo === "oferta") pontos += 3;

    if (titulo.length >= 40 && titulo.length <= 150) pontos += 2;
    if (/[!?]/.test(item.title)) pontos -= 1;

    return { ...item, tipo: tipo, urgente: false, score: pontos };
}

function similaridade(a, b) {
    const palavrasA = new Set(normalizar(a).split(" ").filter(p => p.length > 3));
    const palavrasB = new Set(normalizar(b).split(" ").filter(p => p.length > 3));
    if (!palavrasA.size || !palavrasB.size) return 0;
    const intersecao = [...palavrasA].filter(p => palavrasB.has(p)).length;
    return intersecao / Math.min(palavrasA.size, palavrasB.size);
}

function selecionar(itens) {
    const avaliados = itens
        .map(pontuar)
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);

    const selecionados = [];
    const fontesUsadas = new Map();
    const tiposUsados = new Map();

    for (const item of avaliados) {
        if (selecionados.length >= config.quantidade) break;

        if (selecionados.some(selecionado =>
            similaridade(selecionado.title, item.title) >= 0.78
        )) continue;

        const fonte = item.source;
        const tipo = item.tipo;
        const repeticaoFonte = fontesUsadas.get(fonte) || 0;
        const repeticaoTipo = tiposUsados.get(tipo) || 0;

        // Evita concentração excessiva sem descartar conteúdo relevante.
        if (repeticaoFonte >= 5 || repeticaoTipo >= 7) continue;

        selecionados.push({
            title: item.title,
            url: item.url,
            tipo: item.tipo,
            urgente: false
        });

        fontesUsadas.set(fonte, repeticaoFonte + 1);
        tiposUsados.set(tipo, repeticaoTipo + 1);
    }

    // Se os limites de diversidade restringirem demais a seleção,
    // completa com os próximos itens válidos ainda não repetidos.
    if (selecionados.length < config.quantidade) {
        for (const item of avaliados) {
            if (selecionados.length >= config.quantidade) break;
            if (selecionados.some(selecionado => selecionado.url === item.url)) continue;
            if (selecionados.some(selecionado => similaridade(selecionado.title, item.title) >= 0.78)) continue;

            selecionados.push({
                title: item.title,
                url: item.url,
                tipo: item.tipo,
                urgente: false
            });
        }
    }

    return selecionados;
}

async function executar() {
    console.log("");
    console.log("=================================");
    console.log("       RADAR AGORA");
    console.log("       MODO AUTÔNOMO");
    console.log("=================================");

    await coletarFontes();

    const itens = removerDuplicados(candidatos).slice(0, 300);
    console.log("Candidatos únicos: " + itens.length);

    if (!itens.length) {
        throw new Error("Nenhum candidato foi encontrado nas fontes.");
    }

    const finais = selecionar(itens);

    if (!finais.length) {
        throw new Error("Nenhum conteúdo passou pelos critérios automáticos. O ticker anterior foi preservado.");
    }

    fs.writeFileSync("data/ticker.json", JSON.stringify({ items: finais }, null, 2) + "\n", "utf8");

    console.log("Itens publicados: " + finais.length);
    finais.forEach((item, indice) => {
        console.log((indice + 1) + ". " + item.title);
        console.log("   " + item.url);
        console.log("   Tipo: " + item.tipo);
    });
}

executar().catch(erro => {
    console.error("");
    console.error("=================================");
    console.error("ERRO RADAR AGORA");
    console.error("=================================");
    console.error(erro.message);
    process.exit(1);
});
