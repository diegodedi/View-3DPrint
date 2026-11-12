# Regra de Compilação e Publicação para GitHub (View 3DPrint)

**CRITICAL RULE: Ao compilar uma nova versão e subir para o GitHub**

Sempre que o usuário pedir para "compilar uma nova versão e subir para o github" (ou variações semelhantes), o agente DEVE entender que o fluxo 100% automático é:

1. **Incrementar a versão** (bump) no `package.json` (ex: de 1.0.0 para 1.0.1).
2. **Commit e Tag** das alterações no Git.
3. **Compilar e Publicar via Script**: Rodar o comando `npm run dist:publish`, que executa:
   `npm run build:vite && dotenv -e .env -- electron-builder --win -p always`
   Esse comando gera o instalador na pasta `release/`, gera o arquivo `latest.yml` e faz o upload da Release para o GitHub (`diegodedi/View-3DPrint`).
4. **Auto-updater no PC do Cliente**: O aplicativo instalado checa o GitHub Releases automaticamente via `electron-updater` e exibe o popup de atualização.

## Autenticação com GitHub (GH_TOKEN)
- O script utiliza o token definido na variável `GH_TOKEN` no arquivo `.env` local.
- O token possui o escopo `repo` configurado.

