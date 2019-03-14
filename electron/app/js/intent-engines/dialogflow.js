const dialogflow = require('dialogflow')
const through2 = require('through2')
const path = require('path')
const uuid = require('uuid')
const config = require(path.join(process.cwd(),'app','config','config.js'))

function setup(){
	// DIALOGFLOW

	//create unique id for new dialogflow session
	const sessionId = uuid.v4()

	//create a dialogflow session
	const sessionClient = new dialogflow.SessionsClient({
		projectId: config.speech.projectId,
		keyFilename: path.join(process.cwd(), 'app', 'config', config.speech.dialogflowKey)
	})

	const sessionPath = sessionClient.sessionPath(config.speech.projectId, sessionId)

	// the dialogflow request
	const dialogflowRequest = {
		session: sessionPath,
		queryParams: {
			session: sessionClient.sessionPath(config.speech.projectId, sessionId)
		},
		queryInput:{
			audioConfig:{
				audioEncoding: "AUDIO_ENCODING_LINEAR_16",
				sampleRateHertz: 16000,
				languageCode: 'en-US'
			}
		},
		singleUtterance: true,
	    interimResults: false
	}

	return {sessionClient, dialogflowRequest}
}

class DialogflowSpeech {

	constructor(mic, client, request, wakewordDetector){
		this.request = request
		this.stream = client.streamingDetectIntent()
		this.result = ''
		this.unpipeTimer = null
		this.listenFor = 5000
		this.intentObj = {}
		this.sttStream = null
		this.mic = mic
		this.wakewordDetector = wakewordDetector

		this.stream.write(this.request)
	}

	startSttStream(){
		this.sttStream =  through2.obj((obj,_,next)=>{
			next(null, {inputAudio: obj})
		})
	}

	startStream(){
		const self = this

		this.startSttStream()

		this.stream.once('pipe', () => {
			console.log('PIPING > DIALOGFLOW')

			self.unpipeTimer = setTimeout(()=>{
				console.log('UNPIPING DIALOGFLOW > QUERY TIME EXCEEDED')
				self.unpipeTimer = null
				self.sttStream.unpipe(self.stream)
				self.mic.unpipe(self.sttStream)
			}, self.listenFor)
		})

		this.stream.on('data', (data) => {
			if(data.queryResult != null){
				
				if(data.queryResult.queryText == ""){
					return
				}

				self.intentObj.intent = data.queryResult.intent.displayName
				self.intentObj.params = data.queryResult.parameters.fields
				self.intentObj.queryText = data.queryResult.queryText
				self.intentObj.responseText = data.queryResult.fulfillmentText

				self.result = self.intentObj

				self.sttStream.unpipe(self.stream)
				self.mic.unpipe(self.sttStream)
			}
		})

		this.stream.once('error', (err) => {
			console.error('ERROR > DIALOGFLOW', err)
		})

		this.stream.once('close', function(){
			console.log('DIALOGFLOW PIPE > CLOSED')
		})

		this.stream.once('unpipe', function(src){
			console.log('UNPIPING > DIALOGFLOW')
			self.sttStream.end()
			self.stream.end()
		})

		this.stream.once('finish', () => {

			console.log("FINISHED > DIALOGFLOW")
			if(self.unpipeTimer != null){
				// timer is running but result has returned already
				clearTimeout(self.unpipeTimer)
				self.unpipeTimer = null
				
				console.log("CLEARING TIMEOUT > RESULT RETURNED")
			}

			if(self.result){
				console.log("DIALOGFLOW > SENDING RESULT")
				event.emit('final-command', self.result)
			} else {
				event.emit('no-command')
			}	

			self.request = null
			self.stream = null
			self.result = null
			self.intentObj = null
			self.sttStream = null

			self.mic.pipe(self.wakewordDetector)

			self.mic = null
			self.wakewordDetector = null

		})

		this.mic.pipe(this.sttStream).pipe(this.stream)
	}
}

module.exports = {
	setup,
	DialogflowSpeech
}