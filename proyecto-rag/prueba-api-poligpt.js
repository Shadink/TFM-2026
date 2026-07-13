import OpenAI from 'openai'
 
const openai = new OpenAI({
	apiKey: 'sk-Q3T-ggr2ZLVOiWPrLaqOVQ',
	baseURL: 'https://api.poligpt.upv.es',
})
 
const response = await openai.chat.completions.create({
	model: 'llama-mini',
	messages: [
		{
			role: 'user',
			content: 'this is a test request, write a short poem'
		}
	],
})

console.log(response.choices[0].message.content);