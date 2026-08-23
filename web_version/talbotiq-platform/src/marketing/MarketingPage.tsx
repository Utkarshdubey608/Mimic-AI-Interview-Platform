import { Link, useParams } from 'react-router-dom'
import { MarketingLayout } from './MarketingLayout'
import { NAV, PAGE_BY_SLUG, type MktPage } from './content'
import { Reveal } from './motion'
import { DemoVideo } from './DemoVideo'
import { demoPosterSrc, demoVideoSrc } from './demoAssets'
import { RoiCalculator } from './RoiCalculator'
import { Field } from './Field'
import { InkTrail } from './ink/InkTrail'
import { Blocks, Related } from './sections'
import { Ico } from './icons'

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function Jsonld({ page }: { page: MktPage }) {
  const graph: unknown[] = [
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Mimic', item: 'https://mimic.talbotiq.com/' },
      { '@type': 'ListItem', position: 2, name: page.section, item: `https://mimic.talbotiq.com${page.sectionTo}` },
      { '@type': 'ListItem', position: 3, name: page.kicker.split('·').pop()?.trim() || page.h1, item: `https://mimic.talbotiq.com/${page.slug}` },
    ] },
    { '@type': 'Service', name: `Mimic, ${page.h1}`, serviceType: 'AI candidate screening and interviewing', provider: { '@type': 'Organization', name: 'TalbotIQ' } },
  ]
  if (page.faqs?.length) graph.push({ '@type': 'FAQPage', mainEntity: page.faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) })
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }) }} />
}

function Breadcrumbs({ page }: { page: MktPage }) {
  const leaf = page.kicker.includes('·') ? page.kicker.split('·').pop()!.trim() : page.h1
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <Link to="/">Mimic</Link><span>/</span>
      <Link to={page.sectionTo}>{page.section}</Link>
      {page.tier !== 'hub' && (<><span>/</span><span aria-current="page">{leaf}</span></>)}
    </nav>
  )
}

export default function MarketingPage() {
  const params = useParams()
  const slug = params['*'] || ''
  const page = PAGE_BY_SLUG[slug]

  if (!page) {
    return (
      <MarketingLayout seo={{ title: 'Page not found, Mimic', desc: 'That page could not be found.' }}>
        <main className="mkpage"><div className="wrap mk-empty">
          <h1 className="h2">We couldn’t find that page.</h1>
          <p className="lede">
            The link may be old. Try the platform overview, or book a demo and we’ll point you the right way.
          </p>
          <div className="mk-actions is-centred">
            <Link className="btn btn-primary" to="/">Back to home</Link>
            <Link className="btn btn-ghost" to="/solutions">Explore solutions</Link>
          </div>
        </div></main>
      </MarketingLayout>
    )
  }

  const group = NAV.find((g) => g.to === page.sectionTo)
  const cta = page.cta ?? { title: 'See Mimic on your roles', sub: 'Book a 30-minute walkthrough, no card required.' }
  /* Pages past ~600 words become a wall without an index; hubs are link
     directories and already are one. Plain anchors, no scroll-spy — nothing to
     go stale. */
  const showIndex = page.tier !== 'hub' && page.sections.length >= 4

  return (
    <MarketingLayout seo={{ title: page.metaTitle, desc: page.metaDesc }}>
      <Jsonld page={page} />
      <main className="mkpage">
        <div className="wrap">
          <Breadcrumbs page={page} />
          <header className="mk-hero">
            <h1>{page.h1}</h1>
            <p className="lede">{page.intro}</p>
            <div className="mk-actions">
              <Link className="btn btn-primary" to="/#demo">Book a demo</Link>
              {/* "All company" and "All trust" are not things. The label names
                  the destination — a section overview — which is both accurate
                  and the same shape on all five sections. */}
              {page.tier !== 'hub' && <Link className="btn btn-ghost" to={page.sectionTo}>{page.section} overview</Link>}
            </div>
          </header>
        </div>

        {/* The section index — page chrome, so it lives OUTSIDE the article.
            It began as a card in a right-hand column, which left a 1100x600
            hole on 54 pages, and then as a sticky pill inside the centred
            measure, which half-covered every heading that scrolled past it: a
            floating island narrower than the text it floats over reads as a
            rendering fault. A secondary toolbar spanning the full width, sitting
            directly under the header, is the shape this actually is — content
            passes under it the way it passes under the header itself. That
            requires it to be a sibling of the article rather than a child of it,
            which is why the wrap closes above. */}
        {showIndex && (
          <nav className="mk-index" aria-label="On this page">
            <div className="wrap mk-index-in">
              <h2>On this page</h2>
              <ul>
                {page.sections.map((s) => (
                  <li key={s.h2}><a href={`#${slugify(s.h2)}`}>{s.h2}</a></li>
                ))}
                {page.faqs?.length ? <li><a href="#questions">Questions</a></li> : null}
              </ul>
            </div>
          </nav>
        )}

        <div className="wrap">
          {/* The format, running.
              A buyer choosing a screening tool is also choosing what they put
              their applicants through, and a feature list cannot answer that.
              Recorded from the real product against a synthetic store — every
              candidate on screen is invented. Sits above the body rather than
              buried in it: on a page whose whole job is to explain one format,
              the footage IS the explanation.
              Only the five interview-track pages set `demo`; everything else
              renders exactly as before. */}
          {page.demo && (
            <Reveal>
              <div className="shots">
                <DemoVideo
                  src={demoVideoSrc(page.demo.track)}
                  poster={demoPosterSrc(page.demo.track)}
                  still={demoPosterSrc(page.demo.track)}
                  caption={page.demo.caption}
                  alt={page.demo.alt}
                  disclosure={page.demo.disclosure}
                  contentAspect={page.demo.contentAspect}
                />
              </div>
            </Reveal>
          )}

          {page.tier === 'hub' && group ? (
            <>
              <div className="hub-cols">
                {group.columns.map((col, i) => (
                  <Reveal key={col.title} as="section" className="hub-col" delay={i * 80}>
                    <h2>{col.title}</h2>
                    <ul>{col.links.map((l) => (
                      <li key={l.label}><Link to={l.to}>{l.label}<Ico n="arrow" /></Link></li>
                    ))}</ul>
                  </Reveal>
                ))}
              </div>
              {/* Hubs used to render their link columns and nothing else, so
                  anything written in `sections` was silently dropped — five
                  landing pages stuck at ~100 words. They render below now. */}
              {page.sections.length > 0 && (
                <div className="mk-body">
                  {page.sections.map((s, i) => (
                    <Reveal key={s.h2} as="section" className="mk-sec" delay={i * 70}>
                      <h2 id={slugify(s.h2)}>{s.h2}</h2>
                      {s.body && <p>{s.body}</p>}
                      {s.bullets && <ul className="mk-bullets">{s.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
                      <Blocks blocks={s.blocks} />
                    </Reveal>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="mk-body">
              {page.slug === 'resources/roi-calculator' && <Reveal><RoiCalculator /></Reveal>}
              {page.sections.map((s, i) => (
                <Reveal key={s.h2} as="section" className="mk-sec" delay={i * 70}>
                  <h2 id={slugify(s.h2)}>{s.h2}</h2>
                  {s.body && <p>{s.body}</p>}
                  {s.bullets && <ul className="mk-bullets">{s.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
                  <Blocks blocks={s.blocks} />
                </Reveal>
              ))}
            </div>
          )}

          <Related links={page.related} />

          {page.faqs?.length ? (
            <section className="mk-faq" aria-label="Frequently asked questions">
              <h2 id="questions" className="mk-faq-h">Questions</h2>
              <div className="faq">
                {page.faqs.map((f, i) => (
                  <details key={f.q} open={i === 0}>
                    <summary>{f.q}<Ico n="chevron" className="chev" /></summary>
                    <p>{f.a}</p>
                  </details>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        {/* The inner pages' one cinematic moment, and it costs nothing extra:
            `.cta` is shared chrome, so every one of the 72 routes gets the same
            ink field the homepage does with no per-page work.

            The inline grid columns below finally apply, too — `.cta-in` was never
            `display:grid`, so this style has been inert since it was written. */}
        <section className="cta cta-page">
          <Field seed={11} />
          <InkTrail />
          <div className="wrap cta-in cta-in-page">
            <div>
              <h2>{cta.title}</h2>
              <p className="sub">{cta.sub}</p>
            </div>
            <Link className="btn btn-light btn-lg" to="/#demo">Book a demo</Link>
          </div>
        </section>
      </main>
    </MarketingLayout>
  )
}
