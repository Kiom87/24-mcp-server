# RAG basics

Retrieval-augmented generation answers a question in three steps:

1. Split documents into chunks and store an embedding for each one.
2. Embed the question and fetch the closest chunks from a vector store.
3. Give those chunks to the model as context and ask it to answer.

Chunk size matters. Too small loses context, too large dilutes the match.
