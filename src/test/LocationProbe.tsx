import { useLocation } from "react-router-dom"

/** Shows the router's current location, so a test can assert URL state (test helper only). */
export function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}
