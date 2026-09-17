const fs = require("fs");
const https = require("https");
const http = require("http");

const config = JSON.parse(fs.readFileSync("config.json", "utf8"));

const fontes = config.fontes.filter(fonte => fonte.ativo === true);
const resultados = [];

function baixar(url) {
	return new Promise((resolve, reject) => {
		const cliente = url.startsWith("https://") ? https : http;

		const requisicao = cliente.get(url, {
			headers: {
				"User-Agent": "Mozilla/5.0 RADAR-AGORA/1.0"
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

		requisicao.on("error", reject);
	});
}

function limparTexto(texto) {
	return texto
		.replace(/<!\[CDATA\[|\]\]>/g, "")
		.replace(/<[^>]*>/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
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

function urlValida(url, fonte) {
	if (!/^https?:\/\//i.test(url)) {
		return false;
	}

	const urlNormalizada = url.replace(/\/$/, "");
	const fonteNormalizada = fonte.url.replace(/\/$/, "");

	if (urlNormalizada === fonteNormalizada) {
		return false;
	}

	if (/\/(buscar|search|busca|tag|tags|categoria|categorias|author|autor|perfil)\b/i.test(url)) {
		return false;
	}

	if (/[?&](page|pagina|p)=\d+/i.test(url)) {
		return false;
	}

	return true;
}

function tituloValido(titulo) {
	if (!titulo) {
		return false;
	}

	if (titulo.length < 25 || titulo.length > 250) {
		return false;
	}

	const proibidos = [
		"menu",
		"login",
		"entrar",
		"cadastre",
		"facebook",
		"instagram",
		"youtube",
		"twitter",
		"whatsapp",
		"veja mais",
		"leia mais",
		"saiba mais",
		"próxima página",
		"página anterior"
	];

	const texto = titulo.toLowerCase();

	for (const palavra of proibidos) {
		if (texto === palavra || texto.startsWith(palavra + " ")) {
			return false;
		}
	}

	return true;
}

function adicionarResultado(titulo, url, fonte) {
	titulo = limparTexto(titulo);
	url = urlAbsoluta(url, fonte.url);

	if (!tituloValido(titulo)) {
		return;
	}

	if (!urlValida(url, fonte)) {
		return;
	}

	resultados.push({
		titulo: titulo,
		url: url,
		fonte: fonte.nome
	});
}

function coletarRSS(xml, fonte) {
	const itens = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)];

	for (const item of itens) {
		const bloco = item[0];

		const titulo = bloco.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
		const link = bloco.match(/<link[^>]*>([\s\S]*?)<\/link>/i);

		if (titulo && link) {
			adicionarResultado(
				titulo[1],
				link[1],
				fonte
			);
		}
	}

	const entradas = [...xml.matchAll(/<entry[\s\S]*?<\/entry>/gi)];

	for (const entrada of entradas) {
		const titulo = entrada[0].match(/<title[^>]*>([\s\S]*?)<\/title>/i);
		const link = entrada[0].match(/<link[^>]*href=["']([^"']+)["']/i);

		if (titulo && link) {
			adicionarResultado(
				titulo[1],
				link[1],
				fonte
			);
		}
	}
}

function coletarHTML(html, fonte) {
	const links = [...html.matchAll(
		/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
	)];

	for (const item of links) {
		const url = item[1];
		const titulo = limparTexto(item[2]);

		adicionarResultado(
			titulo,
			url,
			fonte
		);
	}
}

async function executar() {
	console.log("=== RADAR AGORA ===");
	console.log(`Fontes ativas: ${fontes.length}`);
	console.log("");

	for (const fonte of fontes) {
		console.log(`Coletando: ${fonte.nome}`);
		console.log(`Tipo: ${fonte.tipo}`);
		console.log(`URL: ${fonte.url}`);

		try {
			const conteudo = await baixar(fonte.url);

			if (fonte.tipo === "rss" || fonte.tipo === "atom") {
				coletarRSS(conteudo, fonte);
			} else {
				coletarHTML(conteudo, fonte);
			}

			console.log("OK");
		} catch (erro) {
			console.log(`ERRO: ${erro.message}`);
		}

		console.log("");
	}

	const unicos = [];
	const urls = new Set();

	for (const item of resultados) {
		const url = item.url.replace(/\/$/, "");

		if (urls.has(url)) {
			continue;
		}

		urls.add(url);

		unicos.push({
			titulo: item.titulo,
			url: url,
			fonte: item.fonte
		});
	}

	fs.writeFileSync(
		"fontes_coletadas.json",
		JSON.stringify(
			{
				total: unicos.length,
				itens: unicos
			},
			null,
			2
		)
	);

	console.log("=== RESULTADO ===");
	console.log(`Itens coletados após filtragem: ${unicos.length}`);
	console.log("Arquivo: fontes_coletadas.json");
	console.log("");

	unicos.slice(0, 20).forEach((item, indice) => {
		console.log(`${indice + 1}. ${item.titulo}`);
		console.log(`   ${item.url}`);
		console.log(`   Fonte: ${item.fonte}`);
	});
}

executar();}

function limparTexto(texto) {
	return texto
		.replace(/<!\[CDATA\[|\]\]>/g, "")
		.replace(/<[^>]*>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/\s+/g, " ")
		.trim();
}

function adicionarResultado(titulo, url, fonte) {
	titulo = limparTexto(titulo);
	url = limparTexto(url);

	if (!titulo || !url) {
		return;
	}

	if (!/^https?:\/\//i.test(url)) {
		return;
	}

	resultados.push({
		titulo: titulo,
		url: url,
		fonte: fonte
	});
}

function coletarRSS(xml, fonte) {
	const itens = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)];

	for (const item of itens) {
		const bloco = item[0];

		const titulo = bloco.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
		const link = bloco.match(/<link[^>]*>([\s\S]*?)<\/link>/i);

		if (titulo && link) {
			adicionarResultado(
				titulo[1],
				link[1],
				fonte.nome
			);
		}
	}
}

function coletarHTML(html, fonte) {
	const links = [...html.matchAll(
		/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
	)];

	for (const item of links) {
		let url = item[1];
		const titulo = limparTexto(item[2]);

		if (!titulo) {
			continue;
		}

		if (url.startsWith("/")) {
			const base = new URL(fonte.url);
			url = `${base.origin}${url}`;
		}

		if (!/^https?:\/\//i.test(url)) {
			continue;
		}

		if (url === fonte.url) {
			continue;
		}

		adicionarResultado(
			titulo,
			url,
			fonte.nome
		);
	}
}

async function executar() {
	console.log("=== RADAR AGORA ===");
	console.log(`Fontes ativas: ${fontes.length}`);
	console.log("");

	for (const fonte of fontes) {
		console.log(`Coletando: ${fonte.nome}`);
		console.log(`Tipo: ${fonte.tipo}`);
		console.log(`URL: ${fonte.url}`);

		try {
			const conteudo = await baixar(fonte.url);

			if (fonte.tipo === "rss") {
				coletarRSS(conteudo, fonte);
			} else {
				coletarHTML(conteudo, fonte);
			}

			console.log("OK");
		} catch (erro) {
			console.log(`ERRO: ${erro.message}`);
		}

		console.log("");
	}

	const unicos = [];
	const urls = new Set();

	for (const item of resultados) {
		if (!urls.has(item.url)) {
			urls.add(item.url);
			unicos.push(item);
		}
	}

	fs.writeFileSync(
		"fontes_coletadas.json",
		JSON.stringify(
			{
				total: unicos.length,
				itens: unicos
			},
			null,
			2
		)
	);

	console.log("=== RESULTADO ===");
	console.log(`Itens coletados: ${unicos.length}`);
	console.log("Arquivo: fontes_coletadas.json");
	console.log("");

	unicos.slice(0, 20).forEach((item, indice) => {
		console.log(`${indice + 1}. ${item.titulo}`);
		console.log(`   ${item.url}`);
		console.log(`   Fonte: ${item.fonte}`);
	});
}

executar();
