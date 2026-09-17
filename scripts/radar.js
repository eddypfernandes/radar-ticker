const fs = require("fs");
const https = require("https");

const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const regras = JSON.parse(fs.readFileSync("regras.json", "utf8"));

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
	console.error("GEMINI_API_KEY não encontrada.");
	process.exit(1);
}

const fontes = config.fontes.filter(fonte => fonte.ativo === true);
const candidatos = [];

function baixar(url) {
	return new Promise((resolve, reject) => {

		const cliente = url.startsWith("https://")
			? https
			: require("http");

		const requisicao = cliente.get(url, {
			headers: {
				"User-Agent": "Mozilla/5.0 RADAR-AGORA/1.0",
				"Accept": "text/html,application/xhtml+xml"
			}
		}, resposta => {

			let dados = "";

			resposta.setEncoding("utf8");

			resposta.on("data", parte => {
				dados += parte;
			});

			resposta.on("end", () => {

				if (resposta.statusCode >= 200 && resposta.statusCode < 400) {
					resolve(dados);
				} else {
					reject(new Error(`HTTP ${resposta.statusCode}`));
				}
			});
		});

		requisicao.setTimeout(20000, () => {
			requisicao.destroy(
				new Error("Tempo limite excedido")
			);
		});

		requisicao.on("error", reject);
	});
}

function limparTexto(texto) {

	return texto
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]*>/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&#(\d+);/g, (_, codigo) =>
			String.fromCharCode(Number(codigo))
		)
		.replace(/\s+/g, " ")
		.trim();
}

function urlAbsoluta(url, origem) {

	try {
		return new URL(url, origem).href;
	} catch {
		return "";
	}
}

function parecePublicacao(url, titulo, fonte) {

	if (!url || !titulo) {
		return false;
	}

	if (titulo.length < 30 || titulo.length > 220) {
		return false;
	}

	if (!/^https?:\/\//i.test(url)) {
		return false;
	}

	const texto = `${url} ${titulo}`.toLowerCase();

	const ignorados = [
		"/login",
		"/entrar",
		"/cadastro",
		"/search",
		"/busca",
		"/buscar",
		"/tag/",
		"/tags/",
		"/categoria/",
		"/categorias/",
		"/author/",
		"/autor/",
		"/perfil/",
		"/contato",
		"/sobre",
		"/publicidade",
		"/newsletter",
		"facebook.com",
		"instagram.com",
		"youtube.com",
		"twitter.com",
		"linkedin.com",
		"whatsapp.com"
	];

	for (const item of ignorados) {

		if (texto.includes(item)) {
			return false;
		}
	}

	const origem = new URL(fonte.url);

	if (
		url.replace(/\/$/, "") ===
		origem.href.replace(/\/$/, "")
	) {
		return false;
	}

	return true;
}

function extrairHTML(html, fonte) {

	const links = [
		...html.matchAll(
			/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
		)
	];

	for (const item of links) {

		const url = urlAbsoluta(item[1], fonte.url);
		const titulo = limparTexto(item[2]);

		if (!parecePublicacao(url, titulo, fonte)) {
			continue;
		}

		candidatos.push({
			title: titulo,
			url: url,
			source: fonte.nome
		});
	}
}

async function coletarFontes() {

	console.log("=== COLETA ===");
	console.log(`Fontes ativas: ${fontes.length}`);
	console.log("");

	for (const fonte of fontes) {

		console.log(`Fonte: ${fonte.nome}`);

		try {

			const html = await baixar(fonte.url);

			extrairHTML(html, fonte);

			console.log("OK");

		} catch (erro) {

			console.log(`ERRO: ${erro.message}`);
		}

		console.log("");
	}
}

function removerDuplicados() {

	const mapa = new Map();

	for (const item of candidatos) {

		const chave = item.url.replace(/\/$/, "");

		if (!mapa.has(chave)) {
			mapa.set(chave, item);
		}
	}

	return [...mapa.values()];
}

function esperar(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function chamarGemini(itens) {

	const prompt = `
Você é o curador do RADAR AGORA, um ticker local de Brasília.

Selecione conteúdos relevantes para:

- Núcleo Bandeirante;
- Guará;
- Candangolândia;
- Riacho Fundo;
- Samambaia;
- Park Way;
- Brasília;
- Distrito Federal.

Podem ser notícias, eventos, esportes, lazer, cultura, gastronomia,
comércio, serviços, vagas, trânsito, utilidade pública e atualidades.

Priorize conteúdos locais, mas aceite conteúdos relevantes de Brasília e DF.

REGRAS:

- Use somente os títulos e URLs fornecidos.
- Não invente títulos.
- Não invente URLs.
- Não altere URLs.
- Não escolha páginas de busca.
- Não escolha categorias.
- Não escolha tags.
- Não escolha perfis.
- Evite duplicados.
- Não invente conteúdo para completar a quantidade.

CONFIGURAÇÃO:

${JSON.stringify(config, null, 2)}

REGRAS DO RADAR:

${JSON.stringify(regras, null, 2)}

CONTEÚDOS:

${JSON.stringify(itens, null, 2)}

Retorne SOMENTE JSON válido:

{
	"items": [
		{
			"title": "Título original",
			"url": "URL original",
			"tipo": "noticia",
			"urgente": false
		}
	]
}

Quantidade máxima: ${config.quantidade}
`;

	const dados = JSON.stringify({

		contents: [
			{
				parts: [
					{
						text: prompt
					}
				]
			}
		],

		generationConfig: {
			responseMimeType: "application/json"
		}
	});

	for (let tentativa = 1; tentativa <= 3; tentativa++) {

		console.log(
			`Tentativa Gemini: ${tentativa}/3`
		);

		try {

			const resultado = await chamarGeminiAPI(dados);

			return resultado;

		} catch (erro) {

			console.log(
				`Gemini falhou: ${erro.message}`
			);

			if (tentativa < 3) {

				console.log(
					"Aguardando 5 segundos..."
				);

				await esperar(5000);
			}
		}
	}

	throw new Error(
		"Gemini permaneceu indisponível após 3 tentativas."
	);
}

function chamarGeminiAPI(dados) {

	return new Promise((resolve, reject) => {

		const requisicao = https.request({

			hostname:
				"generativelanguage.googleapis.com",

			path:
				"/v1beta/models/gemini-3.5-flash-lite:generateContent",

			method: "POST",

			headers: {
				"x-goog-api-key": apiKey,
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(dados)
			}

		}, resposta => {

			let corpo = "";

			resposta.setEncoding("utf8");

			resposta.on("data", parte => {
				corpo += parte;
			});

			resposta.on("end", () => {

				if (
					resposta.statusCode < 200 ||
					resposta.statusCode >= 300
				) {

					reject(
						new Error(
							`HTTP ${resposta.statusCode}: ${corpo}`
						)
					);

					return;
				}

				resolve(corpo);
			});
		});

		requisicao.setTimeout(60000, () => {
			requisicao.destroy(
				new Error("Tempo limite Gemini")
			);
		});

		requisicao.on("error", reject);

		requisicao.write(dados);
		requisicao.end();
	});
}

function processarResposta(resposta, itensOriginais) {

	const dados = JSON.parse(resposta);

	const texto =
		dados.candidates?.[0]?.content?.parts?.[0]?.text;

	if (!texto) {
		throw new Error("Gemini não retornou conteúdo.");
	}

	const resultado = JSON.parse(texto);

	const urlsOriginais = new Set(
		itensOriginais.map(item =>
			item.url.replace(/\/$/, "")
		)
	);

	const finais = [];
	const urlsUsadas = new Set();

	for (const item of resultado.items || []) {

		if (!item.title || !item.url) {
			continue;
		}

		const url = item.url.replace(/\/$/, "");

		if (!urlsOriginais.has(url)) {
			continue;
		}

		if (urlsUsadas.has(url)) {
			continue;
		}

		urlsUsadas.add(url);

		finais.push({
			title: item.title.trim(),
			url: url,
			tipo: item.tipo || "atualidade",
			urgente: item.urgente === true
		});

		if (finais.length >= config.quantidade) {
			break;
		}
	}

	return finais;
}

async function executar() {

	console.log("");
	console.log("=================================");
	console.log("       RADAR AGORA");
	console.log("=================================");
	console.log("");

	await coletarFontes();

	let itens = removerDuplicados();

	console.log("=== COLETA FINAL ===");
	console.log(`Candidatos encontrados: ${itens.length}`);

	if (itens.length === 0) {

		throw new Error(
			"Nenhum candidato foi encontrado nas fontes."
		);
	}

	itens = itens.slice(0, 120);

	console.log(
		`Candidatos enviados ao Gemini: ${itens.length}`
	);

	console.log("");
	console.log("=== CURADORIA GEMINI ===");

	const resposta = await chamarGemini(itens);

	const finais = processarResposta(
		resposta,
		itens
	);

	fs.writeFileSync(
		"data/ticker.json",
		JSON.stringify(
			{
				items: finais
			},
			null,
			2
		)
	);

	console.log("");
	console.log("=== RESULTADO ===");
	console.log(`Itens publicados: ${finais.length}`);
	console.log("Arquivo: data/ticker.json");
	console.log("");

	finais.forEach((item, indice) => {

		console.log(
			`${indice + 1}. ${item.title}`
		);

		console.log(
			`   ${item.url}`
		);
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
