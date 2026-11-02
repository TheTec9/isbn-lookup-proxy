export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const isbn = (req.query.isbn || '').replace(/[^0-9X]/gi, '');
  if (!isbn) return res.status(400).json({ error: 'Missing isbn parameter' });

  function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
  }

  async function tryGoogleBooks() {
    const r = await fetchWithTimeout('https://www.googleapis.com/books/v1/volumes?q=isbn:' + isbn + '&maxResults=1', {}, 5000);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.totalItems || d.totalItems === 0) return null;
    const info = d.items[0].volumeInfo;
    if (!info || !info.title) return null;
    return {
      title: info.title, author: (info.authors || []).join(', '),
      publisher: info.publisher || '', year: (info.publishedDate || '').substring(0, 4),
      pages: info.pageCount || 0, genre: (info.categories || []).slice(0, 3).join(', '),
      description: typeof info.description === 'string' ? info.description.substring(0, 300) : '',
      isbn, source: 'google_books'
    };
  }

  async function tryOpenLibraryISBN() {
    const r = await fetchWithTimeout('https://openlibrary.org/isbn/' + isbn + '.json', {}, 5000);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.title) return null;
    let authorName = '';
    if (d.authors && d.authors.length > 0) {
      try {
        const ar = await fetchWithTimeout('https://openlibrary.org' + d.authors[0].key + '.json', {}, 3000);
        if (ar.ok) authorName = (await ar.json()).name || '';
      } catch (_) {}
    }
    const desc = typeof d.description === 'string' ? d.description.substring(0, 300)
      : (d.description && d.description.value ? d.description.value.substring(0, 300) : '');
    return {
      title: d.title, author: authorName, publisher: (d.publishers || []).join(', '),
      year: d.publish_date || '', pages: d.number_of_pages || 0,
      genre: (d.subjects || []).slice(0, 3).join(', '), description: desc,
      isbn, source: 'open_library'
    };
  }

  async function tryOpenLibrarySearch() {
    const r = await fetchWithTimeout('https://openlibrary.org/search.json?isbn=' + isbn + '&limit=1&fields=title,author_name,publisher,first_publish_year,number_of_pages_median,subject', {}, 5000);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.numFound || d.numFound === 0) return null;
    const doc = d.docs[0];
    if (!doc.title) return null;
    return {
      title: doc.title, author: (doc.author_name || []).join(', '),
      publisher: (doc.publisher || []).slice(0, 1).join(', '),
      year: doc.first_publish_year ? String(doc.first_publish_year) : '',
      pages: doc.number_of_pages_median || 0, genre: (doc.subject || []).slice(0, 3).join(', '),
      description: '', isbn, source: 'open_library_search'
    };
  }

  try {
    const results = await Promise.allSettled([tryGoogleBooks(), tryOpenLibraryISBN()]);
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && r.value.title) {
        return res.status(200).json(r.value);
      }
    }
  } catch (e) { console.log('Parallel lookup error:', e.message); }

  try {
    const searchResult = await tryOpenLibrarySearch();
    if (searchResult && searchResult.title) return res.status(200).json(searchResult);
  } catch (e) { console.log('OL Search error:', e.message); }

  const chinaKey = process.env.CHINA_ISBN_API_KEY;
  if (chinaKey) {
    try {
      const cUrl = new URL('https://app-bo4w33bsdqm9-api-ra5EZDjVKbza-gateway.appmiaoda.com/isbn/query');
      cUrl.searchParams.set('isbn', isbn);
      const cRes = await fetchWithTimeout(cUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=UTF-8', 'X-Gateway-Authorization': 'Bearer ' + chinaKey }
      }, 4000);
      if (cRes.ok) {
        const cData = await cRes.json();
        if (cData.code === 200 && cData.data && cData.data.details && cData.data.details.length > 0) {
          const d = cData.data.details[0];
          return res.status(200).json({
            title: d.title || '', author: d.author || '', publisher: d.publisher || '',
            year: (d.pubDate || '').substring(0, 4), pages: parseInt(d.page) || 0,
            genre: d.cipTxt || 'General', description: (d.gist || '').substring(0, 300),
            isbn, source: 'china_isbn_api'
          });
        }
      }
    } catch (e) { console.log('China ISBN API error:', e.message); }
  }

  return res.status(404).json({ error: 'Book not found', isbn });
}
