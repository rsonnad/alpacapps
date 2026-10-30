import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock
from bridge import AppServer, Bridge, Store


class InboxTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root/'token').write_text('t'*48)
        self.server = Bridge(('127.0.0.1',0),self.root,start_worker=False)
        threading.Thread(target=self.server.serve_forever,daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def request(self, method, path, data=None, auth=True, dedupe=None):
        c=http.client.HTTPConnection(*self.server.server_address)
        headers={'Content-Type':'application/json'}
        if auth: headers['Authorization']='Bearer '+'t'*48
        if dedupe: headers['Idempotency-Key']=dedupe
        c.request(method,path,json.dumps(data) if data is not None else None,headers)
        r=c.getresponse(); status=r.status; body=json.loads(r.read());c.close()
        return status,body

    def test_auth_and_private_results(self):
        self.assertEqual(self.request('POST','/webhook',{'body':'hello'},auth=False)[0],401)
        self.assertEqual(self.request('GET','/v1/messages/'+'0'*36,auth=False)[0],401)

    def test_durable_delivery_and_idempotency(self):
        status,a=self.request('POST','/webhook',{'body':'hello'},dedupe='same')
        self.assertEqual(status,202)
        status,b=self.request('POST','/webhook',{'body':'hello'},dedupe='same')
        self.assertEqual((status,b['id']),(200,a['id']))
        self.assertEqual(self.request('POST','/webhook',{'body':'changed'},dedupe='same')[0],409)
        mid,payload=self.server.store.claim()
        self.assertEqual(mid,a['id'])
        self.server.store.update(mid,status='completed',response='Acknowledged')
        self.assertEqual(self.request('GET',a['status_url'])[1]['response'],'Acknowledged')

    def test_unsafe_and_unknown_fields(self):
        for payload in [{'body':'hello','threadId':'other'}, {'to':'other','body':'hello'}, {'body':'hello','links':['file:///etc/passwd']}, {'body':'hello','links':['https://user:password@example.com/']}]:
            self.assertEqual(self.request('POST','/webhook',payload)[0],400)

    def test_interrupted_job_not_replayed(self):
        _,a=self.request('POST','/webhook',{'body':'hello'})
        self.server.store.claim()
        restarted=Store(self.root)
        self.assertEqual(restarted.get(a['id'])['status'],'failed')
        self.assertIsNone(restarted.claim())

    def test_codex_receives_tool_output_and_only_final_reply_is_stored(self):
        mid,_=self.server.store.accept({'body':'hello'},None)
        self.server.store.claim()
        app=AppServer(self.root)
        app.proc=Mock()
        app.proc.poll.return_value=None
        app.rpc=Mock(side_effect=[{'thread':{'id':'thread-1'}},{'turn':{'id':'turn-1'}}])
        app.next=Mock(side_effect=[
            {'method':'item/completed','params':{'threadId':'thread-1','turnId':'turn-1','item':{'id':'comment','type':'agentMessage','phase':'commentary','text':'Thinking'}}},
            {'method':'item/completed','params':{'threadId':'thread-1','turnId':'turn-1','item':{'id':'answer','type':'agentMessage','phase':'final_answer','text':'Acknowledged'}}},
            {'method':'turn/completed','params':{'threadId':'thread-1','turn':{'id':'turn-1','status':'completed'}}}])
        app.process(self.server.store,mid,{'body':'hello'})
        params=app.rpc.call_args_list[-1].args[1]
        self.assertEqual(params['input'],[])
        self.assertEqual(json.loads(params['toolOutput']['output']),{'body':'hello'})
        self.assertEqual(params['sandboxPolicy'],{'type':'readOnly','networkAccess':False})
        result=self.server.store.get(mid)
        self.assertEqual((result['status'],result['response']),('completed','Acknowledged'))


if __name__=='__main__': unittest.main()
