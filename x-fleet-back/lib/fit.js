import { etaBetween } from './maps.js'
const W = { travel: 0.5, disruption: 0.2, skill: -0.25, value: -0.15, window: 0.2, geo: 0.05, balance: 0.05 }

export async function scoreAllReps(job, reps){
  const out = []
  for (const rep of reps){ const s = await scoreRep(job, rep); out.push({ repId: rep.id, repName: rep.name, ...s }) }
  out.sort((a,b)=> a.total - b.total); return out
}

async function scoreRep(job, rep){
  const route = rep.route || []
  let best = { total: Infinity, atIndex: 0, startTime: job.startTime }
  for (let i=0; i<=route.length; i++){
    const prev = route[i-1], next = route[i]
    const t1 = prev ? await etaBetween(prev, job) : 0
    const t2 = next ? await etaBetween(job, next) : 0
    const t0 = prev && next ? await etaBetween(prev, next) : 0
    const deltaTravel = Math.max(0, t1 + t2 - t0)
    const disruption = i>0 && i<route.length ? 1 : 0
    const skill = (rep.skills||[]).includes(job.jobType) ? 1 : 0.5
    const value = (job.estValue||0) / 50000
    const window = withinWindow(job.startTime, job.endTime) ? 0 : 1
    const geo = rep.territory && job.territory && rep.territory!==job.territory ? 1 : 0
    const balance = Math.max(0, (rep.route?.length||0) - 4) * 0.1
    const total = W.travel*minutes(deltaTravel) + W.disruption*disruption + W.skill*(1-skill) + W.value*(value) + W.window*window + W.geo*geo + W.balance*balance
    if (total < best.total){ best = { total, atIndex: i, startTime: job.startTime, reason: `Δtravel ~${Math.round(minutes(deltaTravel))}m, skill=${skill}, value=${(value*100|0)}%` } }
  }
  return best
}
function withinWindow(start, end){ return !!start && !!end }
function minutes(n){ return typeof n === 'number' ? n : 0 }
