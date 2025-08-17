// hooks/useForecast.js

import useSWR from 'swr'
import { API_BASE } from '../config'

const fetcher = (url) => fetch(url).then((r) => r.json())

/**
 * Extended forecast (up to 16 days) powered by your backend /api/forecast.
 * Returns SWR's { data, error, isLoading }.
 */
export function useForecast(lat, lng, days = 10) {
  const latNum = Number(lat)
  const lngNum = Number(lng)

  const latOk = Number.isFinite(latNum)
  const lngOk = Number.isFinite(lngNum)

  const key =
    latOk && lngOk
      ? `${API_BASE}/api/forecast?lat=${latNum.toFixed(3)}&lng=${lngNum.toFixed(3)}&days=${days}`
      : null

  return useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60 * 1000, // 5 min client-side dedupe (server also caches)
    shouldRetryOnError: true,
  })
}