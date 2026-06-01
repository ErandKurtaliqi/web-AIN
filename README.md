<table border="0">
 <tr>
    <td><img src="https://uni-pr.edu/images/logosmall.png" width="150" alt="University Logo" /></td>
    <td>
      <p>Universiteti i Prishtinës</p>
      <p>Fakulteti i Inxhinierisë Elektrike dhe Kompjuterike</p>
      <p>Inxhinieri Kompjuterike dhe Softuerike - Programi Master</p>
      <p>Profesor: Prof. Dr. Kadri Sylejmani</p>
      <p>Asistent: MSc. Labeat Arbneshi</p>
    </td>
 </tr>
</table>

## Përshkrim

Ky repository është krijuar për lëndën Algoritmet e inspiruara nga natyra për vitin akademik 2025/26. Repository përmban të gjitha zgjidhjet, kodet dhe iterimet e grupeve për secilën javë të lëndës.

Përveç algoritmeve Python, projekti përfshin **platformën web** (simulator vizual + API) për testimin e algoritmeve të planifikimit TV në kohë reale.

## Instruksione për setup dhe workflow në vazhdim të projektit

Hap projektin në editor (VS Code, PyCharm, etj.), pastaj bëni pull nga branch-i kryesor (`main`).

Në këtë repository po përdoren branch-e të dedikuara për grupet.

Bëni merge të ndryshimeve nga branch-i `main` tek branch-i i grupit tuaj për të marrë versionin më të fundit të kodit.

Në fund të punës, krijoni pull request nga branch-i i grupit tuaj tek branch-i `main`. Pas rishikimit, ndryshimet bashkohen në `main`.

---

# Komanda për nisjen e platformës

> Të gjitha komandat më poshtë: hapni terminalin në folderin **`web-AIN`** (rrënja e projektit).

```powershell
cd path\to\web-AIN
```

Arkitektura e plotë: [PLATFORM_README.md](./PLATFORM_README.md)

## Parakushtet

| Mjeti | Versioni |
|-------|----------|
| Python | 3.10+ |
| .NET SDK | 8.0 |
| Node.js | 18+ |

```powershell
python --version
python -m pip --version
dotnet --version
node --version
npm --version
```

> Në Windows, përdorni `python -m pip` nëse `pip` nuk funksionon.

---

## 1. Instalimi (vetëm herën e parë)

```powershell
cd web-AIN
python -m pip install -r python_api/requirements.txt
cd frontend\scheduling-dashboard
npm install
cd ..\..
```

---

## 2. Nisja e platformës (3 terminale)

**Rendi:** Python API → .NET backend → Angular frontend.

| # | Shërbimi | Port | URL |
|---|----------|------|-----|
| 1 | Python FastAPI | 8000 | http://localhost:8000/docs |
| 2 | .NET API + SignalR | 5000 | http://localhost:5000/api/schedule/instances |
| 3 | Web simulator | 4200 | http://localhost:4200 |

### Terminal 1 — Python API

```powershell
cd web-AIN
python -m uvicorn python_api.api:app --host 0.0.0.0 --port 8000 --reload --reload-dir python_api
```

**Ose:**

```powershell
cd web-AIN
.\start-python-api.ps1
```

### Terminal 2 — .NET backend

```powershell
cd web-AIN\backend\SchedulingAPI
dotnet run --urls "http://localhost:5000"
```

**Ose:**

```powershell
cd web-AIN
.\start-backend.ps1
```

### Terminal 3 — Angular web simulator

```powershell
cd web-AIN\frontend\scheduling-dashboard
npx ng serve --open
```

**Ose:**

```powershell
cd web-AIN
.\start-frontend.ps1
```

Hapni shfletuesin te **http://localhost:4200** — dropdown-i i instancave duhet të plotësohet automatikisht.

---

## 3. Verifikimi

Me të 3 terminalet aktive:

```powershell
Invoke-WebRequest http://localhost:8000/instances -UseBasicParsing
Invoke-WebRequest http://localhost:5000/api/schedule/instances -UseBasicParsing
Invoke-WebRequest http://localhost:4200 -UseBasicParsing
```

Çdo komandë duhet të kthejë status **200**.

---

## 4. Algoritmet Python pa web (CLI)

```powershell
cd web-AIN
python main.py
```

Zgjedh instancë nga `data/input/`; rezultati ruhet në `data/solutions/ils/`.

---

## 5. Ndërprerja

Në secilin terminal: `Ctrl+C`.

---

## Probleme të zakonshme

| Problem | Zgjidhje |
|---------|----------|
| Dropdown bosh | Nisni së pari Python (:8000), pastaj .NET (:5000), pastaj Angular. Rifreskoni http://localhost:4200 |
| `pip` nuk njihet | Përdorni `python -m pip install ...` |
| Port i zënë | Mbyllni procesin e vjetër ose ndryshoni portin në komandë |
| Git tregon `bin/`, `obj/` | Këto janë në `.gitignore` — mos i commit-oni (shihni seksionin Git më poshtë) |

---

## Git — çfarë të mos commit-oni

Projekti përdor `.gitignore` për skedarët e build-it:

- `backend/**/bin/`, `backend/**/obj/` (.NET)
- `frontend/**/node_modules/`, `.angular/` (Angular)
- `__pycache__/`, `venv/` (Python)

Nëse `bin/` ose `obj/` janë commit-uar më parë, hiqini nga Git (pa fshirë skedarët lokale):

```powershell
cd web-AIN
git rm -r --cached backend/SchedulingAPI/bin backend/SchedulingAPI/obj
git add .gitignore
git status
```

Pastaj commit-oni vetëm ndryshimet e kodit burimor.

---

# Algoritmet-e-inspiruara-ne-natyre-web
