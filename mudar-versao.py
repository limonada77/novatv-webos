import sys
import json
from pathlib import Path

if len(sys.argv) != 2:
    print("Uso:")
    print("python3 mudar-versao.py 1.0.1")
    raise SystemExit(1)

version = sys.argv[1].strip()

if not version:
    raise SystemExit("Versão vazia")

appinfo = Path("appinfo.json")
repo = Path("repo.json")

if not appinfo.exists():
    raise SystemExit("appinfo.json não encontrado")

data = json.loads(appinfo.read_text(encoding="utf-8"))

old = data.get("version")
data["version"] = version

appinfo.write_text(
    json.dumps(data, indent=2, ensure_ascii=False),
    encoding="utf-8"
)

print(f"appinfo.json: {old} -> {version}")

if repo.exists():
    repo_data = json.loads(repo.read_text(encoding="utf-8"))

    packages = repo_data.get("packages", [])

    if packages:
        manifest = packages[0].get("manifest", {})

        manifest["version"] = version
        manifest["ipkUrl"] = (
            "https://raw.githubusercontent.com/"
            "limonada77/novatv-webos/main/"
            f"releases/com.xtreamplay.app_{version}_all.ipk"
        )

        repo.write_text(
            json.dumps(
                repo_data,
                indent=2,
                ensure_ascii=False
            ),
            encoding="utf-8"
        )

        print(f"repo.json atualizado para {version}")
    else:
        print("AVISO: packages não encontrado no repo.json")

print()
print("Nova versão:", version)
print(
    "IPK esperado:",
    f"com.xtreamplay.app_{version}_all.ipk"
)
