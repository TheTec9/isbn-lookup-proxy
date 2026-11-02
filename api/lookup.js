export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const isbn = (req.query.isbn || '').replace(/[^0-9X]/gi, '');
  if (!isbn) return res.status(400).json({ error: 'Missing isbn parameter' });

  let book = null;

  // Strategy 1: Google Books API (same source as hmdpublishing.com ISBN lookup)
  try {
    const gRes = await fetch('https://www.googleapis.com/books/v1/volumes?q=isbn:' + isbn + '&maxResults=1');
    if (gRes.ok) {
      const gData = await gRes.json();
      if (gData.totalItems > 0) {
        const info = gData.items[0].volumeInfo;
        const description = typeof info.description === 'string' ? info.description.substring(0, 300) : '';
        const genres = (info.categories || []).slice(0, 3).join(', ');
        book = {
          title: info.title || '',
          author: (info.authors || []).join(', '),
          publisher: info.publisher || '',
          year: (info.publishedDate || '').substring(0, 4),
          pages: info.pageCount || 0,
          genre: genres,
          description: description,
          isbn: isbn,
          source: 'google_books'
        };
      }
    }
  } catch (e) { console.log('Google Books error:', e.message); }

  // Strategy 2: Open Library ISBN API
  if (!book || !book.title) {
    try {
      const olRes = await fetch('https://openlibrary.org/isbn/' + isbn + '.json');
      if (olRes.ok) {
        const olData = await olRes.json();
        let authorName = '';
        if (olData.authors && olData.authors.length > 0) {
          try {
            const aRes = await fetch('https://openlibrary.org' + olData.authors[0].key + '.json');
            if (aRes.ok) {
              const aData = await aRes.json();
              authorName = aData.name || '';
            }
          } catch (ae) {}
        }
        const desc = typeof olData.description === 'string'
          ? olData.description.substring(0, 300)
          : (olData.description && olData.description.value
              ? olData.description.value.substring(0, 300) : '');
        book = {
          title: olData.title || '',
          author: authorName,
          publisher: (olData.publishers || []).join(', '),
          year: olData.publish_date || '',
          pages: olData.number_of_pages || 0,
          genre: (olData.subjects || []).slice(0, 3).join(', '),
          description: desc,
          isbn: isbn,
          source: 'open_library'
        };
      }
    } catch (e) { console.log('Open Library error:', e.message); }
  }

  // Strategy 3: Open Library Search
  if (!book || !book.title) {
    try {
      const sRes = await fetch('https://openlibrary.org/search.json?isbn=' + isbn + '&limit=1');
      if (sRes.ok) {
        const sData = await sRes.json();
        if (sData.numFound > 0) {
          const doc = sData.docs[0];
          book = {
            title: doc.title || '',
            author: (doc.author_name || []).join(', '),
            publisher: (doc.publisher || []).slice(0, 1).join(', '),
            year: doc.first_publish_year ? String(doc.first_publish_year) : '',
            pages: doc.number_of_pages_median || 0,
            genre: (doc.subject || []).slice(0, 3).join(', '),
            description: '',
            isbn: isbn,
            source: 'open_library_search'
          };
        }
      }
    } catch (e) { console.log('OL Search error:', e.message); }
  }

  if (book && book.title) return res.status(200).json(book);
  return res.status(404).json({ error: 'Book not found', isbn: isbn });
}
