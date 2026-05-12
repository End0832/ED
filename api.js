const PROXY = 'https://icy-night-46e3.end-b76.workers.dev'
const API_VERSION = '4.90.1'

let xToken = null
let mfaCredentials = null

// ── News ───────────────────────────────────────────────────────────────────
let textHash = null
async function checkNews() {
  const res = await fetch("./news.txt")
  const text = await res.text()
  textHash = await hash(text)
  const lastSeenHash = localStorage.getItem("ed_last_news")
  
  if (lastSeenHash === textHash) return

  showNews(text)
}

// ── Hash ───────────────────────────────────────────────────────────────────
async function hash(text) {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)

  const buffer = await crypto.subtle.digest("SHA-256", data)

  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
}

// ── Storage ────────────────────────────────────────────────────────────────
function saveCredentials(u, p) { localStorage.setItem('ed_u', u); localStorage.setItem('ed_p', p) }
function loadCredentials() {
  const u = localStorage.getItem('ed_u'), p = localStorage.getItem('ed_p')
  return u && p ? { username: u, password: p } : null
}
function saveCnCv(cn, cv) { localStorage.setItem('ed_cn', cn); localStorage.setItem('ed_cv', cv) }
function loadCnCv() { return { cn: localStorage.getItem('ed_cn'), cv: localStorage.getItem('ed_cv') } }
function clearStorage() { ['ed_u','ed_p','ed_cn','ed_cv'].forEach(k => localStorage.removeItem(k)) }

// ── API ────────────────────────────────────────────────────────────────────
async function apiPost(path, bodyObj, extraHeaders = {}) {
  const res = await fetch(`${PROXY}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', ...extraHeaders },
    body: 'data=' + JSON.stringify(bodyObj)
  })
  const token = res.headers.get('x-token')
  if (token) xToken = token
  const text = await res.text()
  try { return JSON.parse(text) }
  catch(e) { throw new Error('Réponse non-JSON : ' + text.slice(0, 100)) }
}


// ── Whitelist ──────────────────────────────────────────────────────────────
async function whitelist(mot) {
    const response = await fetch("whitelist.txt");
    const contenu = await response.text();

    const liste = contenu.split("\n").map(l => l.trim());

    return liste.includes(mot)
}

// ── Login ──────────────────────────────────────────────────────────────────
async function login(username, password) {
  showLoading('Connexion…', username)
  $('login-error').style.display = 'none'
  try {
    const whitelisted = await whitelist(username);
    if (!whitelisted) throw new Error("Accès interdit")
    const { cn, cv } = loadCnCv()
    const bodyData = cn && cv
      ? { identifiant: username, motdepasse: password, isRelogin: false, cn, cv, uuid: '', fa: [{ cn, cv }] }
      : { identifiant: username, motdepasse: password, isRelogin: false }

    const json = await apiPost(`/v3/login.awp?v=${API_VERSION}`, bodyData)

    if (json.code === 505) throw new Error('Identifiants invalides')
    if (json.code !== 200 && json.code !== 250) throw new Error(`Erreur API ${json.code}`)

    saveCredentials(username, password)

    if (json.code === 250) {
      mfaCredentials = { username, password }
      await showMfa()
      return
    }

    const acc = json.data?.accounts?.[0]
    await loadGrades(acc?.id, acc ? `${acc.prenom} ${acc.nom}`.trim() : '')

  } catch(e) { showScreen('login'); showError(e.message) }
}

// ── MFA ────────────────────────────────────────────────────────────────────
async function showMfa() {
  try {
    const headers = xToken ? { 'x-token': xToken } : {}
    const json = await apiPost(`/v3/connexion/doubleauth.awp?verbe=get&v=${API_VERSION}`, {}, headers)
    if (!json.data) throw new Error('Réponse MFA invalide')

    $('mfa-question-text').textContent = atob(json.data.question)
    const options = json.data.propositions.map(p => atob(p))
    const container = $('mfa-options')
    container.innerHTML = ''
    let selectedAnswer = null

    options.forEach(opt => {
      const el = document.createElement('div')
      el.className = 'mfa-option'
      el.innerHTML = `<div class="mfa-radio"></div><span>${opt}</span>`
      el.addEventListener('click', () => {
        container.querySelectorAll('.mfa-option').forEach(o => o.classList.remove('selected'))
        el.classList.add('selected')
        selectedAnswer = opt
        $('btn-mfa').disabled = false
      })
      container.appendChild(el)
    })

    $('btn-mfa').onclick = async () => {
      if (!selectedAnswer) return
      showLoading('Vérification MFA…')
      try {
        const h2 = xToken ? { 'x-token': xToken } : {}
        const res = await apiPost(`/v3/connexion/doubleauth.awp?verbe=post&v=${API_VERSION}`, { choix: btoa(selectedAnswer) }, h2)
        const cn = res.data?.cn, cv = res.data?.cv
        if (!cn || !cv) throw new Error('Device tokens absents')
        saveCnCv(cn, cv)

        const bodyData = { identifiant: mfaCredentials.username, motdepasse: mfaCredentials.password, isRelogin: false, cn, cv, uuid: '', fa: [{ cn, cv }] }
        const json2 = await apiPost(`/v3/login.awp?v=${API_VERSION}`, bodyData)
        if (json2.code !== 200) throw new Error('Re-login échoué après MFA')
        const acc = json2.data?.accounts?.[0]
        await loadGrades(acc?.id, acc ? `${acc.prenom} ${acc.nom}`.trim() : '')
      } catch(e) { showScreen('login'); showError(e.message) }
    }

    showScreen('mfa')
  } catch(e) { showScreen('login'); showError('Erreur MFA : ' + e.message) }
}

// ── Notes ──────────────────────────────────────────────────────────────────
async function loadGrades(studentId, studentName) {
  showLoading('Chargement des notes…', studentName)
  try {
    const headers = xToken ? { 'x-token': xToken } : {}
    const json = await apiPost(`/v3/eleves/${studentId}/notes.awp?verbe=get&v=${API_VERSION}`, { token: xToken }, headers)
    if (json.code !== 200) throw new Error(`Erreur notes ${json.code}`)
    renderGrades(studentName, parseGrades(json.data))
  } catch(e) { showScreen('login'); showError('Erreur notes : ' + e.message) }
}

function pf(s) {
  if (s === null || s === undefined || s === '') return null
  const n = parseFloat(String(s).replace(',', '.'))
  return isNaN(n) ? null : n
}

function parseGrades(data) {
  const notes = data.notes || []
  const periodes = (data.periodes || []).filter(p =>
    !p.annuel && p.codePeriode && ['A001','A002','A003'].includes(p.codePeriode)
  )

  const allGrades = notes.map(n => {
    const value = pf(n.valeur), outOf = pf(n.noteSur) ?? 20, coef = pf(n.coef) ?? 1
    const rawVal = String(n.valeur || '').trim()
    const isDispensed = rawVal !== '' && value === null  // y'a quelque chose mais c'est pas un nombre
    return {
      name: n.devoir || '', value, outOf, coef,
      subject: n.libelleMatiere || '?',
      codeMatiere: n.codeMatiere || '',
      period: n.codePeriode || '',
      date: n.date || '', classAvg: pf(n.moyenneClasse),
      nonSignificatif: n.nonSignificatif || false,
      isDispensed,
      rawVal,
      normalized: value !== null && outOf > 0 ? (value / outOf) * 20 : null
    }
  })

  return periodes.sort((a, b) => a.codePeriode.localeCompare(b.codePeriode)).map(p => {
    const pg = allGrades.filter(g => g.period === p.codePeriode)

    // Récupérer le mapping codeMatiere → groupe depuis periodes
    const disciplines = p.ensembleMatieres?.disciplines || []
    const groupes = disciplines.filter(d => d.groupeMatiere)
    const idTronc = groupes.find(g => g.discipline === 'TRONC COMMUN')?.id
    const idOpt   = groupes.find(g => g.discipline === 'OPTIONS')?.id

    const codesTC  = new Set(disciplines.filter(d => !d.groupeMatiere && d.idGroupeMatiere === idTronc).map(d => d.codeMatiere))
    const codesOpt = new Set(disciplines.filter(d => !d.groupeMatiere && d.idGroupeMatiere === idOpt).map(d => d.codeMatiere))

    // Calculer la moyenne d'une liste de notes
    function calcAvg(grades) {
      const valid = grades.filter(g => g.normalized !== null && !g.nonSignificatif)
      const totalCoef = valid.reduce((s, g) => s + g.coef, 0)
      return totalCoef > 0 ? valid.reduce((s, g) => s + g.normalized * g.coef, 0) / totalCoef : null
    }

    function calcClassAvg(grades) {
      const valid = grades.filter(g => g.classAvg !== null && g.outOf > 0 && !g.nonSignificatif)
      const totalCoef = valid.reduce((s, g) => s + g.coef, 0)
      return totalCoef > 0 ? valid.reduce((s, g) => s + (g.classAvg / g.outOf) * 20 * g.coef, 0) / totalCoef : null
    }

    // Construire les sujets
    const allSubjectNames = [...new Set(pg.map(g => g.subject))]
    const subjects = allSubjectNames.map(name => {
      const grades = pg.filter(g => g.subject === name)
      const codeMatiere = grades[0]?.codeMatiere || ''
      // Chercher la moyenne ED pour cette matière
      const edDiscipline = disciplines.find(d => d.codeMatiere === codeMatiere && !d.groupeMatiere)
      const edAverage = pf(edDiscipline?.moyenne)
      return {
        name, codeMatiere,
        average: calcAvg(grades),
        edAverage,   // ← moyenne telle qu'ED la stocke
        classAverage: calcClassAvg(grades),
        grades: grades.sort((a, b) => a.date.localeCompare(b.date))
      }
    }).sort((a, b) => {
      if (a.average === null && b.average === null) return a.name.localeCompare(b.name)
      if (a.average === null) return 1; if (b.average === null) return -1
      return b.average - a.average
    })

    // Séparer TC et Options
    const round2 = (n) => Number(Math.round((n + Number.EPSILON) * 100) / 100)
    const tc = subjects
      .filter(s => codesTC.has(s.codeMatiere))
      .map(s => ({
        ...s,
        average: s.average !== null ? round2(s.average) : null
      }))

    const opt = subjects
      .filter(s => codesOpt.has(s.codeMatiere))
      .map(s => ({
        ...s,
        average: s.average !== null ? round2(s.average) : null
      }))
    const edTcMoy  = pf(disciplines.find(d => d.groupeMatiere && d.discipline === 'TRONC COMMUN')?.moyenne)
    const edOptMoy = pf(disciplines.find(d => d.groupeMatiere && d.discipline === 'OPTIONS')?.moyenne)

    // Moyenne générale sur toutes les matières (TC + opt)
    const validAvgs = subjects.map(s => s.average).filter(a => a !== null && a > 0)
    const generalAvg = validAvgs.length > 0 ? validAvgs.reduce((s, a) => s + a, 0) / validAvgs.length : null

    return {
      periodId: p.codePeriode,
      label: p.periode || p.codePeriode,
      isClosed: p.cloture,
      generalAverage: generalAvg,
      subjects,  // toutes les matières
      tc,        // tronc commun uniquement
      opt,      // options uniquement
      edTcMoy,
      edOptMoy
    }
  })
}
