import React from 'react'
export default function Link({ href, children, ...rest }: any) { return <a href={href} {...rest}>{children}</a> }
export const usePathname = () => (typeof window !== 'undefined' ? window.location.pathname : '/')
export const useRouter = () => ({ push() {}, replace() {}, refresh() {} })
export const useParams = () => ({})
