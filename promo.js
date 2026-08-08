// Owner-only recommendations panel.
//
// Renders a short French panel suggesting technical improvements for the site.
// It only appears for someone who opens the site with the correct preview key
// (e.g. https://example.ma/?apercu=SECRET). Ordinary visitors never see it, so
// the site's real traffic and conversions are untouched.
//
// The key is stored as a SHA-256 hash in promo-config.json, so reading that
// public file does not reveal the link.
//
// Add to each page, just before </body>:
//   <script defer src="/promo.js"></script>

const CATALOG = {
  chatbot: {
    name: 'Assistant conversationnel (IA)',
    desc: "Répondre automatiquement aux questions des visiteurs 24h/24 et enregistrer les demandes reçues en dehors des heures d'ouverture, au lieu de les perdre."
  },
  seo: {
    name: 'SEO — Optimisation pour les moteurs de recherche',
    desc: "Améliorer le positionnement du site dans les résultats de recherche afin d'attirer des visiteurs qualifiés de façon régulière, sans dépendre uniquement de la publicité payante."
  },
  optimizations: {
    name: 'Optimisations continues',
    desc: "Améliorations régulières du site — vitesse, parcours d'achat, formulaires — afin que les performances ne se dégradent pas au fil des mises à jour et des ajouts de contenu."
  },
  pagespeed: {
    name: 'Optimisation de la vitesse de chargement',
    desc: "Réduire le temps d'affichage sur mobile, où une part importante des visiteurs quitte la page avant même de la voir. Intervention ponctuelle, sans abonnement."
  },
  content: {
    name: 'Articles publiés automatiquement (IA)',
    desc: "Publier régulièrement des articles optimisés pour les moteurs de recherche, sans rédaction manuelle. La régularité de publication est l'un des signaux les plus constants pour apparaître durablement dans les résultats."
  },
  crm: {
    name: 'Gestion centralisée des contacts (CRM)',
    desc: "Regrouper tous les contacts au même endroit et suivre chaque demande jusqu'à sa conclusion, pour éviter les relances oubliées et les opportunités perdues."
  }
};

(async function () {
  const PARAM = 'apercu';
  const DISMISS_KEY = 'promo_dismissed_v1';

  const key = new URLSearchParams(location.search).get(PARAM);
  if (!key) return;
  if (sessionStorage.getItem(DISMISS_KEY)) return;

  let config;
  try {
    const res = await fetch('/promo-config.json', { cache: 'no-store' });
    if (!res.ok) return;
    config = await res.json();
  } catch {
    return;
  }

  if (!config || config.enabled !== true || !config.keyHash) return;
  if ((await sha256Hex(key)) !== config.keyHash) return;

  const services = Array.isArray(config.services) ? config.services : [];
  if (!services.length) return;

  render(services.map((id) => withAudit(CATALOG[id], id, config.audit)).filter(Boolean));

  // A measured PageSpeed score, when one was captured, replaces the generic SEO
  // wording. Reporting Google's public measurement is a fact; it is never
  // dressed up as Google recommending anything.
  function withAudit(entry, id, audit) {
    if (!entry) return null;
    if ((id !== 'seo' && id !== 'pagespeed') || !audit || typeof audit.score !== 'number') return entry;

    const speed = audit.lcp ? ` Le contenu principal s'affiche en ${audit.lcp} sur mobile.` : '';
    const where = audit.strategy === 'mobile' ? 'mobile' : 'ordinateur';
    const measured = `Mesure du ${audit.fetchedAt} sur ${where}.${speed}`;

    if (id === 'pagespeed') {
      return {
        name: `Vitesse — ${audit.score}/100 sur Google PageSpeed Insights`,
        desc: `${measured} Réduire ce temps d'affichage retient les visiteurs qui ` +
          'quittent la page avant de la voir. Intervention ponctuelle, sans abonnement.'
      };
    }

    return {
      name: `SEO — ${audit.score}/100 sur Google PageSpeed Insights`,
      desc: `${measured} Améliorer la vitesse et le positionnement permet d'attirer ` +
        'des visiteurs qualifiés de façon régulière, sans dépendre uniquement de la publicité payante.'
    };
  }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function render(items) {
    const panel = document.createElement('div');
    panel.dir = 'ltr';
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', 'Recommandations techniques');
    panel.innerHTML = `
      <style>
        .rec-panel{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:min(370px,calc(100vw - 32px));
          background:#ffffff;color:#0f172a;border-radius:14px;box-shadow:0 12px 40px rgba(15,23,42,.22);
          font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;overflow:hidden;
          animation:rec-in .28s ease-out}
        @keyframes rec-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
        .rec-head{padding:16px 18px 12px;border-bottom:1px solid #e2e8f0;display:flex;
          align-items:flex-start;justify-content:space-between;gap:12px}
        .rec-title{font-size:14.5px;font-weight:700;line-height:1.35}
        .rec-sub{font-size:12px;color:#64748b;margin-top:3px}
        .rec-close{border:none;background:transparent;cursor:pointer;font-size:20px;line-height:1;
          color:#94a3b8;padding:0 2px}
        .rec-close:hover{color:#475569}
        .rec-body{padding:6px 18px 4px;max-height:52vh;overflow-y:auto}
        .rec-item{padding:12px 0;border-bottom:1px solid #f1f5f9}
        .rec-item:last-child{border-bottom:none}
        .rec-name{font-size:13.5px;font-weight:600;margin-bottom:3px}
        .rec-desc{font-size:12.5px;line-height:1.55;color:#475569}
        .rec-foot{padding:12px 18px 16px;font-size:12px;color:#64748b;background:#f8fafc}
        @media (prefers-color-scheme: dark){
          .rec-panel{background:#1e293b;color:#f1f5f9}
          .rec-head{border-bottom-color:#334155}
          .rec-item{border-bottom-color:#334155}
          .rec-desc{color:#cbd5e1}
          .rec-foot{background:#0f172a;color:#94a3b8}
        }
      </style>
      <div class="rec-panel">
        <div class="rec-head">
          <div>
            <div class="rec-title">Recommandations techniques pour votre site</div>
            <div class="rec-sub">${items.length} amélioration${items.length > 1 ? 's' : ''} suggérée${items.length > 1 ? 's' : ''}</div>
          </div>
          <button class="rec-close" type="button" aria-label="Fermer">&times;</button>
        </div>
        <div class="rec-body">
          ${items.map((s) => `
            <div class="rec-item">
              <div class="rec-name">${s.name}</div>
              <div class="rec-desc">${s.desc}</div>
            </div>`).join('')}
        </div>
        <div class="rec-foot">Contactez votre prestataire technique pour la mise en place.</div>
      </div>`;

    panel.querySelector('.rec-close').addEventListener('click', () => {
      sessionStorage.setItem(DISMISS_KEY, '1');
      panel.remove();
    });

    document.body.appendChild(panel);
  }
})();
