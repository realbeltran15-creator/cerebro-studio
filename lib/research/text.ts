/** Lower-case, accent-free, punctuation-free text padded with spaces, so words can be found with simple `includes(' word ')` checks. ß becomes ss. */
export const fold = (s: string) => ` ${s.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}#+]+/gu, ' ').replace(/\s+/g, ' ').trim()} `
