import { useState } from 'react'

/** A real, interactive first-round ROI estimate for the /resources/roi-calculator
 *  page. Honest framing: it estimates the manual first-round screening time Mimic
 *  gives back, from the recruiter's own inputs. Not a guarantee. */
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const num = (n: number) => Math.round(n).toLocaleString('en-US')

export function RoiCalculator() {
  const [applicants, setApplicants] = useState(500)   // per month
  const [minutes, setMinutes] = useState(20)           // per manual screen
  const [rate, setRate] = useState(45)                 // loaded recruiter cost / hr

  const hoursMonth = (applicants * minutes) / 60
  const costMonth = hoursMonth * rate
  const costYear = costMonth * 12

  return (
    <div className="roi" role="group" aria-label="First round ROI estimator">
      <div className="controls">
        <div className="ctl">
          <label htmlFor="roi-a">Applicants per month <b>{num(applicants)}</b></label>
          <input id="roi-a" type="range" min={50} max={5000} step={50} value={applicants} onChange={(e) => setApplicants(+e.target.value)} />
        </div>
        <div className="ctl">
          <label htmlFor="roi-m">Minutes per manual screen <b>{minutes}m</b></label>
          <input id="roi-m" type="range" min={5} max={45} step={1} value={minutes} onChange={(e) => setMinutes(+e.target.value)} />
        </div>
        <div className="ctl">
          <label htmlFor="roi-r">Loaded recruiter cost / hour <b>{money(rate)}</b></label>
          <input id="roi-r" type="range" min={20} max={120} step={5} value={rate} onChange={(e) => setRate(+e.target.value)} />
        </div>
        <p className="roi-note">Estimate of the manual first round screening Mimic gives back. Your mileage varies, book a demo for a tailored model.</p>
      </div>
      <div className="results" aria-live="polite">
        <div className="res"><div className="n">{num(hoursMonth)}</div><div className="l">Recruiter hours returned / month</div></div>
        <div className="res"><div className="n">{money(costMonth)}</div><div className="l">First round cost returned / month</div></div>
        <div className="res"><div className="n">{money(costYear)}</div><div className="l">Returned / year</div></div>
      </div>
    </div>
  )
}
