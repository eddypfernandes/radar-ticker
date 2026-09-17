const fs = require("fs");
const https = require("https");

const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const regras = JSON.parse(fs.readFileSync("regras.json", "utf8"));
const fontes = JSON.parse(fs.readFileSync("fontes_coletadas.json", "utf8"));

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
	console.error("GEMINI_API_KEY não encontrada.");
	process.exit(1);
}

const candidatos = fontes.itens.slice(0, 150);

const prompt = `
Você é o curador editorial do RADAR AGORA.

Selecione conteúdos reais e relevantes para Brasília e Distrito Federal.

CONFIGURAÇÃO:
${JSON.stringify(config, null, 2)}

REGRAS:
${JSON.stringify(regras, null, 2)}

CANDIDATOS:
${JSON.stringify(candidatos, null, 2)}

CRITÉRIOS:

1. Use somente candidatos fornecidos.
2. Não invente título.
3. Não invente URL.
4. Não altere URL.
5. Priorize Núcleo Bandeirante.
6. Depois considere Guará, Candangolândia, Riacho Fundo, Samambaia e Park Way.
7. Conteúdos gerais de Brasília ou Distrito Federal podem ser utilizados quando forem relevantes.
8. Priorize conteúdo recente.
9. Evite duplicados.
10. Não selecione páginas de categoria, busca, tags, perfis ou páginas genéricas.
11. Se não houver conteúdo suficiente, retorne menos itens.
12. Nunca invente conteúdo para completar a quantidade.

TIPOS PERMITIDOS:
noticia
evento
oferta
vaga
dica
atualidade

Retorne SOMENTE JSON válido:

{
	"items": [
		{
			"title": "título original",
			"url": "URL original",
			"tipo": "noticia",
			"urgente": false
		}
	]
}

Máximo de ${config.quantidade} itens.
`;

function chamarGemini() {
	return new Promise((resolve, reject) => {
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

		const requisicao = https.request({
			hostname: "generativelanguage.googleapis.com",
			path: "/v1beta/models/gemini-3.6-flash:generateContent",
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
				if (resposta.statusCode < 200 || resposta.statusCode >= 300) {
					reject(new Error(`Gemini HTTP ${resposta.statusCode}: ${corpo}`));
					return;
				}

				resolve(corpo);
			});
		});

		requisicao.on("error", reject);
		requisicao.write(dados);
		requisicao.end();
	});
}

function extrairResposta(resposta) {
	const dados = JSON.parse(resposta);

	const texto = dados
		.candidates?.[0]
		?.content
		?.parts?.[0]
		?.text;

	if (!texto) {
		throw new Error("Gemini não retornou conteúdo.");
	}

	return JSON.parse(texto);
}

function validarItem(item, coletados) {
	if (!item.title || !item.url) {
		return false;
	}

	const encontrado = coletados.find(
		origem =>
			origem.url.replace(/\/$/, "") === item.url.replace(/\/$/, "")
	);

	if (!encontrado) {
		return false;
	}

	if (!/^https?:\/\//i.test(item.url)) {
		return false;
	}

	return true;
}

async function executar() {
	console.log("=== RADAR AGORA — CURADORIA ===");
	console.log(`Candidatos enviados ao Gemini: ${candidatos.length}`);
	console.log("");

	try {
		const resposta = await chamarGemini();
		const resultado = extrairResposta(resposta);

		const itensValidos = resultado.items.filter(item =>
			validarItem(item, fontes.itens)
		);

		const urls = new Set();
		const finais = [];

		for (const item of itensValidos) {
			const url = item.url.replace(/\/$/, "");

			if (urls.has(url)) {
				continue;
			}

			urls.add(url);

			finais.push({
				title: item.title,
				url: url,
				tipo: item.tipo,
				urgente: item.urgente === true
			});
		}

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

		console.log("=== RESULTADO ===");
		console.log(`Itens selecionados: ${finais.length}`);
		console.log("Arquivo atualizado: data/ticker.json");
		console.log("");

		finais.forEach((item, indice) => {
			console.log(`${indice + 1}. ${item.title}`);
			console.log(`   ${item.url}`);
			console.log(`   Tipo: ${item.tipo}`);
			console.log(`   Urgente: ${item.urgente}`);
		});

	} catch (erro) {
		console.error("ERRO NA CURADORIA:");
		console.error(erro.message);
		process.exit(1);
	}
}

executar();
