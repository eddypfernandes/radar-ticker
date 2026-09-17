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

const prompt = `
Você é o curador editorial do RADAR AGORA.

Sua tarefa é selecionar conteúdos reais, recentes e relevantes para Brasília e regiões prioritárias do Distrito Federal.

CONFIGURAÇÃO:
${JSON.stringify(config, null, 2)}

REGRAS EDITORIAIS:
${JSON.stringify(regras, null, 2)}

CONTEÚDOS COLETADOS:
${JSON.stringify(fontes.itens, null, 2)}

CRITÉRIOS:

1. Selecione somente conteúdos cujo título e URL estejam presentes nos dados coletados.
2. Não invente títulos.
3. Não invente URLs.
4. Não altere URLs.
5. Não crie notícias a partir de informações que não estejam nos dados.
6. Priorize Núcleo Bandeirante.
7. Depois considere Guará, Candangolândia, Riacho Fundo, Samambaia e Park Way.
8. Também podem ser selecionados conteúdos relevantes para Brasília e Distrito Federal.
9. Dê preferência a conteúdos recentes.
10. Evite conteúdos duplicados.
11. Não selecione páginas iniciais, páginas de categoria, tags, buscas ou perfis.
12. Redes sociais somente quando a URL representar uma publicação individual.
13. Classifique cada item em um dos tipos permitidos:
   noticia, evento, oferta, vaga, dica, atualidade.
14. Use "urgente": true somente quando houver motivo editorial concreto.
15. Não classifique como urgente apenas porque o título contém palavras chamativas.
16. Se não houver conteúdo suficiente e adequado, retorne menos itens.
17. Nunca complete a quantidade inventando conteúdo.

Retorne SOMENTE JSON válido, exatamente neste formato:

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

A quantidade máxima deve ser ${config.quantidade}.
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
			origem.titulo === item.title &&
			origem.url === item.url
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
	console.log(`Conteúdos recebidos: ${fontes.itens.length}`);
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
			if (urls.has(item.url)) {
				continue;
			}

			urls.add(item.url);

			finais.push({
				title: item.title,
				url: item.url,
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
