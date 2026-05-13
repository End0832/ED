const PROXY = 'https://icy-night-46e3.end-b76.workers.dev'
const API_VERSION = '4.90.1'

let xToken = null
let mfaCredentials = null

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
  const response = await fetch("whitelist.txt")
  const contenu = await response.text()
  return contenu.split("\n").map(l => l.trim()).includes(mot)
}

// ── Login ──────────────────────────────────────────────────────────────────
async function login(username, password) {
  showLoading('Connexion…', username)
  $('login-error').style.display = 'none'
  try {
    const whitelisted = await whitelist(username)
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

function round2(n) {
  return n !== null ? Number(Math.round((n + Number.EPSILON) * 100) / 100) : null
}

function calcWeightedAvg(grades) {
  const valid = grades.filter(g => g.normalized !== null && !g.nonSignificatif)
  const totalCoef = valid.reduce((s, g) => s + g.coef, 0)
  return totalCoef > 0 ? valid.reduce((s, g) => s + g.normalized * g.coef, 0) / totalCoef : null
}

function calcWeightedClassAvg(grades) {
  const valid = grades.filter(g => g.classAvg !== null && g.outOf > 0 && !g.nonSignificatif)
  const totalCoef = valid.reduce((s, g) => s + g.coef, 0)
  return totalCoef > 0 ? valid.reduce((s, g) => s + (g.classAvg / g.outOf) * 20 * g.coef, 0) / totalCoef : null
}

// Moyenne simple des valeurs brutes (non arrondies) d'un groupe de matières
function calcGroupAvg(subjects, key) {
  const avgs = subjects.map(s => s[key]).filter(a => a !== null && a > 0)
  return avgs.length > 0 ? round2(avgs.reduce((s, a) => s + a, 0) / avgs.length) : null
}

function parseGrades(data) {
  const notes = data.notes || []
  const periodes = (data.periodes || []).filter(p =>
    !p.annuel && p.codePeriode && ['A001','A002','A003'].includes(p.codePeriode)
  )

  const allGrades = notes.map(n => {
    const value = pf(n.valeur), outOf = pf(n.noteSur) ?? 20, coef = pf(n.coef) ?? 1
    const rawVal = String(n.valeur || '').trim()
    const isDispensed = rawVal !== '' && value === null
    return {
      name: n.devoir || '', value, outOf, coef,
      subject: n.libelleMatiere || '?',
      codeMatiere: n.codeMatiere || '',
      period: n.codePeriode || '',
      date: n.date || '',
      classAvg: pf(n.moyenneClasse),
      nonSignificatif: n.nonSignificatif || false,
      isDispensed,
      rawVal,
      normalized: value !== null && outOf > 0 ? (value / outOf) * 20 : null
    }
  })

  return periodes.sort((a, b) => a.codePeriode.localeCompare(b.codePeriode)).map(p => {
    const pg = allGrades.filter(g => g.period === p.codePeriode)

    const disciplines = p.ensembleMatieres?.disciplines || []
    const groupes = disciplines.filter(d => d.groupeMatiere)
    const idTronc = groupes.find(g => g.discipline === 'TRONC COMMUN')?.id
    const idOpt   = groupes.find(g => g.discipline === 'OPTIONS')?.id

    const codesTC  = new Set(disciplines.filter(d => !d.groupeMatiere && d.idGroupeMatiere === idTronc).map(d => d.codeMatiere))
    const codesOpt = new Set(disciplines.filter(d => !d.groupeMatiere && d.idGroupeMatiere === idOpt).map(d => d.codeMatiere))

    const subjects = [...new Set(pg.map(g => g.subject))].map(name => {
      const grades = pg.filter(g => g.subject === name)
      const codeMatiere = grades[0]?.codeMatiere || ''
      // Bruts : utilisés pour les calculs de groupe (pas d'accumulation d'erreurs d'arrondi)
      const averageRaw      = calcWeightedAvg(grades)
      const classAverageRaw = calcWeightedClassAvg(grades)
      return {
        name, codeMatiere,
        average:          round2(averageRaw),
        classAverage:     round2(classAverageRaw),
        averageRaw,       // interne
        classAverageRaw,  // interne
        grades: grades.sort((a, b) => a.date.localeCompare(b.date))
      }
    }).sort((a, b) => {
      if (a.averageRaw === null && b.averageRaw === null) return a.name.localeCompare(b.name)
      if (a.averageRaw === null) return 1
      if (b.averageRaw === null) return -1
      return b.averageRaw - a.averageRaw
    })

    const tc  = subjects.filter(s => codesTC.has(s.codeMatiere))
    const opt = subjects.filter(s => codesOpt.has(s.codeMatiere))

    return {
      periodId: p.codePeriode,
      label: p.periode || p.codePeriode,
      isClosed: p.cloture,
      generalAverage:      calcGroupAvg(subjects, 'averageRaw'),
      generalClassAverage: calcGroupAvg(subjects, 'classAverageRaw'),
      tcAverage:           calcGroupAvg(tc,  'averageRaw'),
      tcClassAverage:      calcGroupAvg(tc,  'classAverageRaw'),
      optAverage:          calcGroupAvg(opt, 'averageRaw'),
      optClassAverage:     calcGroupAvg(opt, 'classAverageRaw'),
      subjects,
      tc,
      opt
    }
  })
}
