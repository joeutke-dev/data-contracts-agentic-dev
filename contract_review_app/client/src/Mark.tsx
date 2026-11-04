// The app mark: a contract (key: value rows) with a signed seal, in the Databricks product-icon style (flat
// #FF5F46 / #FABFBA, no outlines). Same drawing as public/favicon.svg and docs/images/logo.svg.
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <polygon points="3,2 12.5,2 17.5,7 17.5,22 3,22" fill="#FABFBA" />
      <polygon points="12.5,2 17.5,7 12.5,7" fill="#FF5F46" />
      <rect x="6" y="9.5" width="2.5" height="2" fill="#FF5F46" /><rect x="9.5" y="9.5" width="5" height="2" fill="#FF5F46" />
      <rect x="6" y="13.5" width="2.5" height="2" fill="#FF5F46" /><rect x="9.5" y="13.5" width="3" height="2" fill="#FF5F46" />
      <polygon points="17.5,12.2 21.6,14.6 21.6,19.4 17.5,21.8 13.4,19.4 13.4,14.6" fill="#FF5F46" stroke="#FFFFFF" strokeWidth="2.2" strokeLinejoin="round" />
      <polyline points="15.6,17.1 17,18.5 19.5,16" fill="none" stroke="#FFFFFF" strokeWidth="1.5" strokeLinejoin="miter" />
    </svg>
  );
}
