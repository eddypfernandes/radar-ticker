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

const urls = fontes
	.map(fonte => fonte.url)
	.filter(url => /^https?:\/\//i.test(url));

const prompt = `
Você é o motor de coleta e curadoria editorial do RADAR AGORA.

Você receberá URLs de fontes jornalísticas e informativas públicas.

SUA TAREFA:

1. Acesse as páginas fornecidas usando o contexto de URL.
2. Identifique publicações individuais disponíveis nessas páginas.
3. Analise os títulos e o conteúdo das publicações.
4. Selecione somente conteúdos reais, verificáveis e relevantes.
5. Priorize conteúdo local do Distrito Federal.
6. Dê prioridade máxima ao Núcleo Bandeirante.
7. Depois considere:
   - Guará
   - Candangolândia
   - Riacho Fundo
   - Samambaia
   - Park Way
8. Conteúdos relevantes para Brasília e Distrito Federal também podem ser selecionados.
9. Priorize publicações recentes.
10. Evite duplicações.
11. Não selecione páginas de categoria.
12. Não selecione páginas de busca.
13. Não selecione páginas de tags.
14. Não selecione perfis.
15. Não selecione a página inicial da fonte como conteúdo.
16. Não invente títulos.
17. Não invente URLs.
18. Não altere URLs.
19. A URL deve apontar para a publicação individual.
20. Se não houver conteúdo suficiente, retorne menos itens.
21. Nunca invente itens para completar a quantidade.

REGRAS EDITORIAIS:

${JSON.stringify(regras, null, 2)}

CONFIGURAÇÃO:

${JSON.stringify(config, null, 2)}

TIPOS PERMITIDOS:

- noticia
- evento
- oferta
- vaga
- dica
- atualidade

URGÊNCIA:

Somente marque "urgente": true quando houver motivo editorial concreto e verificável.

Não classifique como urgente apenas porque o título utiliza linguagem chamativa.

RETORNE SOMENTE JSON VÁLIDO.

FORMATO OBRIGATÓRIO:

{
	"items": [
		{
			"title": "título original da publicação",
			"url": "URL direta da publicação",
			"tipo": "noticia",
			"urgente": false
		}
	]
}

Quantidade máxima de itens: ${config.quantidade}.
`;

function chamarGemini(urlsLote) {
	return new Promise((resolve, reject) => {

		const urlsTexto = urlsLote.join("\n");

		const dados = JSON.stringify({
			contents: [
				{
					parts: [
						{
							text: `${prompt}

FONTES PARA ANALISAR:

${urlsTexto}`
						}
					]
				}
			],
			tools: [
				{
					url_context: {}
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
					reject(
						new Error(
							`Gemini HTTP ${resposta.statusCode}: ${corpo}`
						)
					);

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

function extrairResultado(resposta) {

	const dados = JSON.parse(resposta);

	const texto =
		dados.candidates?.[0]
			?.content
			?.parts?.[0]
			?.text;

	if (!texto) {
		throw new Error("Gemini não retornou conteúdo.");
	}

	return JSON.parse(texto);
}

function validarItem(item) {

	if (!item) {
		return false;
	}

	if (!item.title || !item.url) {
		return false;
	}

	if (!/^https?:\/\//i.test(item.url)) {
		return false;
	}

	if (
		/\/(buscar|search|busca|tag|tags|categoria|categorias|author|autor|perfil)\b/i
			.test(item.url)
	) {
		return false;
	}

	const tiposPermitidos = [
		"noticia",
		"evento",
		"oferta",
		"vaga",
		"dica",
		"atualidade"
	];

	if (!tiposPermitidos.includes(item.tipo)) {
		return false;
	}

	return true;
}

async function executar() {

	console.log("=== RADAR AGORA ===");
	console.log("Motor: Gemini + URL Context");
	console.log(`Fontes ativas: ${fontes.length}`);
	console.log(`URLs enviadas: ${urls.length}`);
	console.log("");

	try {

		const resultado = await chamarGemini(urls);

		const dados = extrairResultado(resultado);

		const itensValidos = (dados.items || [])
			.filter(validarItem);

		const finais = [];
		const urlsUsadas = new Set();

		for (const item of itensValidos) {

			const url = item.url.replace(/\/$/, "");

			if (urlsUsadas.has(url)) {
				continue;
			}

			urlsUsadas.add(url);

			finais.push({
				title: item.title.trim(),
				url: url,
				tipo: item.tipo,
				urgente: item.urgente === true
			});

			if (finais.length >= config.quantidade) {
				break;
			}
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

			console.log(
				`   Tipo: ${item.tipo}`
			);

			console.log(
				`   Urgente: ${item.urgente}`
			);
		});

	} catch (erro) {

		console.error("");
		console.error("=== ERRO ===");
		console.error(erro.message);

		process.exit(1);
	}
}

executar();
