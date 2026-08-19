# features/pages

A photographed page belonging to a book. Owns page numbering, the
`(book_id, page_number)` uniqueness rule, and the intrinsic image dimensions
that every annotation coordinate is normalized against.

Uploads go straight from browser to Supabase Storage using a signed URL; image
bytes never pass through this app.

Built in phase 5.
