const API_PROXY   = 'https://icy-night-46e3.end-b76.workers.dev'
const API_VERSION = '4.90.1'

let xToken          = null
let pendingMfaCreds = null

// ── Persistance locale ─────────────────────────────────────────────────────
function saveCredentials(username, password) {
  localStorage.setItem('ed_u', username)
  localStorage.setItem('ed_p', password)
}
function loadCredentials() {
  const username = localStorage.getItem('ed_u')
  const password = localStorage.getItem('ed_p')
  return username && password ? { username, password } : null
}
function saveDeviceTokens(cn, cv) {
  localStorage.setItem('ed_cn', cn)
  localStorage.setItem('ed_cv', cv)
}
function loadDeviceTokens() {
  return { cn: localStorage.getItem('ed_cn'), cv: localStorage.getItem('ed_cv') }
}
function clearStorage() {
  ;['ed_u', 'ed_p', 'ed_cn', 'ed_cv'].forEach(k => localStorage.removeItem(k))
}

// ── Requête API ────────────────────────────────────────────────────────────
async function apiPost(path, body, extraHeaders = {}) {
  const res = await fetch(`${API_PROXY}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', ...extraHeaders },
    body: 'data=' + JSON.stringify(body),
  })
  const token = res.headers.get('x-token')
  if (token) xToken = token
  const text = await res.text()
  let parsedText = null
  try { parsedText = JSON.parse(text) }
  catch (e) { throw new Error('Réponse non-JSON : ' + text.slice(0, 100)) }
  if (parsedText.code === 429) throw new Error("API quota dépassé")
  return parsedText
}

// ── Décodage de requête ────────────────────────────────────────────────────
function decodeBase64UTF8(str) {
  return decodeURIComponent(
    atob(str).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  )
}

// ── Liste blanche ──────────────────────────────────────────────────────────
async function isWhitelisted(username) {
  const res     = await fetch('whitelist.txt')
  const content = await res.text()
  return content.split('\n').map(l => l.trim()).includes(username)
}

// ── Connexion ──────────────────────────────────────────────────────────────
async function login(username, password) {
  showLoading('Connexion…', username)
  $('login-error').style.display = 'none'

  try {
    const allowed = await isWhitelisted(username)
    if (!allowed) throw new Error('Accès interdit')

    const { cn, cv } = loadDeviceTokens()
    const loginBody = cn && cv
      ? { identifiant: username, motdepasse: password, isRelogin: false, cn, cv, uuid: '', fa: [{ cn, cv }] }
      : { identifiant: username, motdepasse: password, isRelogin: false }

    const json = await apiPost(`/v3/login.awp?v=${API_VERSION}`, loginBody)

    if (json.code === 505) throw new Error('Identifiants invalides')
    if (json.code !== 200 && json.code !== 250) throw new Error(`Erreur API ${json.code}`)

    saveCredentials(username, password)

    if (json.code === 250) {
      pendingMfaCreds = { username, password }
      await showMfa()
      return
    }

    const account = json.data?.accounts?.[0]
    await loadGrades(account?.id, account ? `${account.prenom} ${account.nom}`.trim() : '')

  } catch (e) {
    showScreen('login')
    showError(e.message)
  }
}

// ── Double authentification ────────────────────────────────────────────────
async function showMfa() {
  try {
    const headers = xToken ? { 'x-token': xToken } : {}
    const json = await apiPost(`/v3/connexion/doubleauth.awp?verbe=get&v=${API_VERSION}`, {}, headers)
    if (!json.data) throw new Error('Réponse MFA invalide')

    $('mfa-question-text').textContent = decodeBase64UTF8(json.data.question)

    const options   = json.data.propositions.map(p => decodeBase64UTF8(p))
    const container = $('mfa-options')
    container.innerHTML = ''
    let selectedAnswer = null

    options.forEach(option => {
      const el = document.createElement('div')
      el.className = 'mfa-option'
      el.innerHTML = `<div class="mfa-radio"></div><span>${option}</span>`
      el.addEventListener('click', () => {
        container.querySelectorAll('.mfa-option').forEach(o => o.classList.remove('selected'))
        el.classList.add('selected')
        selectedAnswer = option
        $('btn-mfa').disabled = false
      })
      container.appendChild(el)
    })

    $('btn-mfa').onclick = async () => {
      if (!selectedAnswer) return
      showLoading('Vérification MFA…')
      try {
        const headers2  = xToken ? { 'x-token': xToken } : {}
        const mfaResult = await apiPost(
          `/v3/connexion/doubleauth.awp?verbe=post&v=${API_VERSION}`,
          { choix: btoa(selectedAnswer) },
          headers2
        )
        const cn = mfaResult.data?.cn, cv = mfaResult.data?.cv
        if (!cn || !cv) throw new Error('Device tokens absents')
        saveDeviceTokens(cn, cv)

        const reloginBody = {
          identifiant: pendingMfaCreds.username,
          motdepasse:  pendingMfaCreds.password,
          isRelogin:   false,
          cn, cv, uuid: '',
          fa: [{ cn, cv }],
        }
        const reloginJson = await apiPost(`/v3/login.awp?v=${API_VERSION}`, reloginBody)
        if (reloginJson.code !== 200) throw new Error('Re-login échoué après MFA')

        const account = reloginJson.data?.accounts?.[0]
        await loadGrades(account?.id, account ? `${account.prenom} ${account.nom}`.trim() : '')

      } catch (e) {
        showScreen('login')
        showError(e.message)
      }
    }

    showScreen('mfa')
  } catch (e) {
    showScreen('login')
    showError('Erreur MFA : ' + e.message)
  }
}

// ── Notes ──────────────────────────────────────────────────────────────────
async function loadGrades(studentId, studentName) {
  showLoading('Chargement des notes…', studentName)

  try {
    const headers    = xToken ? { 'x-token': xToken } : {}
    const localCheck = await fetch('./notes.json', { method: 'HEAD' })
    let json

    if (localCheck.ok) {
      const res = await fetch('./notes.json')
      json = JSON.parse(await res.text())
    } else {
      json = await apiPost(
        `/v3/eleves/${studentId}/notes.awp?verbe=get&v=${API_VERSION}`,
        { token: xToken },
        headers
      )
    }

    if (json.code !== 200) throw new Error(`Erreur notes ${json.code}`)

    renderGrades(studentName, parseGrades(json.data))

  } catch (e) {
    showScreen('login')
    showError('Erreur notes : ' + e.message)
  }
}

// ── Utilitaires de calcul ──────────────────────────────────────────────────

/** Parse un float depuis n'importe quelle représentation (virgule ou point). Retourne null si invalide. */
function parseFloat2(value) {
  if (value === null || value === undefined || value === '') return null
  const n = parseFloat(String(value).replace(',', '.'))
  return isNaN(n) ? null : n
}

/** Arrondi à 2 décimales avec correction d'erreur flottante. */
function round2(n) {
  return n !== null ? Number(Math.round((n + Number.EPSILON) * 100) / 100) : null
}

/** Moyenne pondérée des notes de l'élève, ramenées sur 20. */
function calcSubjectAverage(grades) {
  const valid     = grades.filter(g => g.normalized !== null && !g.nonSignificatif)
  const totalCoef = valid.reduce((sum, g) => sum + g.coef, 0)
  return totalCoef > 0
    ? valid.reduce((sum, g) => sum + g.normalized * g.coef, 0) / totalCoef
    : null
}

/** Moyenne pondérée des moyennes de classe, ramenées sur 20. */
function calcSubjectClassAverage(grades) {
  const valid     = grades.filter(g => g.classAvg !== null && g.outOf > 0 && !g.nonSignificatif)
  const totalCoef = valid.reduce((sum, g) => sum + g.coef, 0)
  return totalCoef > 0
    ? valid.reduce((sum, g) => sum + (g.classAvg / g.outOf) * 20 * g.coef, 0) / totalCoef
    : null
}

/** Moyenne d'un groupe de matières (tronc commun ou options), pondérée par coef matière. */
function calcGroupAverage(subjects) {
  const valid     = subjects.filter(s => s.average !== null)
  const totalCoef = valid.reduce((sum, s) => sum + s.coefMatiere, 0)
  if (totalCoef <= 0) return null
  return round2(valid.reduce((sum, s) => sum + s.average * s.coefMatiere, 0) / totalCoef)
}

// ── Parsing des données brutes ─────────────────────────────────────────────
function parseGrades(data) {
  const rawNotes = data.notes || []
  const periodes = (data.periodes || []).filter(p =>
    !p.annuel && p.codePeriode && ['A001', 'A002', 'A003'].includes(p.codePeriode)
  )

  // Normalisation de chaque note brute
  const allGrades = rawNotes.map(note => {
    const value  = parseFloat2(note.valeur)
    const outOf  = parseFloat2(note.noteSur) ?? 20
    const rawVal = String(note.valeur || '').trim()

    return {
      name:            note.devoir || '',
      value,
      outOf,
      coef:            parseFloat2(note.coef) ?? 1,
      codeMatiere:     note.codeMatiere || '',
      period:          note.codePeriode || '',
      date:            note.date || '',
      classAvg:        parseFloat2(note.moyenneClasse),
      nonSignificatif: note.nonSignificatif || false,
      isDispensed:     rawVal !== '' && value === null,
      rawVal,
      normalized:      value !== null && outOf > 0 ? (value / outOf) * 20 : null,
    }
  })

  return periodes
    .sort((a, b) => a.codePeriode.localeCompare(b.codePeriode))
    .map(period => {
      const periodGrades = allGrades.filter(g => g.period === period.codePeriode)
      const disciplines  = period.ensembleMatieres?.disciplines || []

      // Identification des groupes "Tronc commun" et "Options"
      const groups        = disciplines.filter(d => d.groupeMatiere)
      const idTroncCommun = groups.find(g => g.discipline === 'TRONC COMMUN')?.id
      const idOptions     = groups.find(g => g.discipline === 'OPTIONS')?.id

      const codesTroncCommun = new Set(
        disciplines
          .filter(d => !d.groupeMatiere && d.idGroupeMatiere === idTroncCommun)
          .map(d => d.codeMatiere)
      )
      const codesOptions = new Set(
        disciplines
          .filter(d => !d.groupeMatiere && d.idGroupeMatiere === idOptions)
          .map(d => d.codeMatiere)
      )

      // Construction des matières, groupées par coef pour tri ultérieur
      const byCoef = {}
      disciplines.filter(d => !d.groupeMatiere).forEach(discipline => {
        const grades      = periodGrades.filter(g => g.codeMatiere === discipline.codeMatiere)
        const coefMatiere = parseFloat2(discipline.coef) ?? 1
        const average     = round2(calcSubjectAverage(grades))

        const subject = {
          name:         discipline.libelle || discipline.discipline || discipline.codeMatiere,
          codeMatiere:  discipline.codeMatiere,
          coefMatiere,
          average,
          classAverage: calcSubjectClassAverage(grades),
          grades:       grades.sort((a, b) => a.date.localeCompare(b.date)),
        }

        if (!byCoef[coefMatiere]) byCoef[coefMatiere] = []
        byCoef[coefMatiere].push(subject)
      })

      // Tri : coef décroissant, puis moyenne décroissante à l'intérieur
      const withAverage = Object.keys(byCoef)
        .sort((a, b) => Number(b) - Number(a))
        .flatMap(coef =>
          byCoef[coef]
            .filter(s => s.average !== null)
            .sort((a, b) => b.average - a.average)
        )

      const withoutAverage = Object.values(byCoef)
        .flat()
        .filter(s => s.average === null)
        .sort((a, b) => b.coefMatiere - a.coefMatiere || a.name.localeCompare(b.name))

      const subjects = [...withAverage, ...withoutAverage]

      return {
        periodId:       period.codePeriode,
        label:          period.periode || period.codePeriode,
        isClosed:       period.cloture,
        generalAverage: calcGroupAverage(subjects),
        tcAverage:      calcGroupAverage(subjects.filter(s => codesTroncCommun.has(s.codeMatiere))),
        optAverage:     calcGroupAverage(subjects.filter(s => codesOptions.has(s.codeMatiere))),
        subjects,
      }
    })
}
