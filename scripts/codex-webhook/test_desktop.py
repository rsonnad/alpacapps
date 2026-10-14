import json
from pathlib import Path
import tempfile
import threading
import unittest
from desktop_mcp import MCP
from task_queue import TaskError, TaskQueue
import test_bridge
from bridge import Bridge


class DesktopQueueTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.q=TaskQueue(self.root)

    def tearDown(self): self.temp.cleanup()

    def test_single_desktop_and_durable_claim(self):
        a,_=self.q.accept({'body':'Calculator'},'one')
        b,_=self.q.accept({'body':'Notes'},'two')
        claim=self.q.claim('desktop')
        self.assertEqual(claim['id'],a)
        self.assertNotIn('claim_token',self.q.get(a))
        self.assertIsNone(TaskQueue(self.root).claim('other-worker'))
        self.q.update(a,claim['claim_token'],'needs_approval','Waiting for native approval')
        self.assertIsNone(self.q.claim('other-worker'))
        self.q.finish(a,claim['claim_token'],'Calculator displayed 391')
        self.q.finish(a,claim['claim_token'],'Calculator displayed 391')
        self.assertEqual(self.q.claim('desktop')['id'],b)

    def test_cannot_forge_completion_or_overwrite_result(self):
        a,_=self.q.accept({'body':'hello'},'one');c=self.q.claim('desktop')
        with self.assertRaises(TaskError):self.q.finish(a,'wrong','completed')
        self.q.finish(a,c['claim_token'],'actual response')
        with self.assertRaises(TaskError):self.q.finish(a,c['claim_token'],'different response')

    def test_mcp_wait_and_report(self):
        a,_=self.q.accept({'body':'Calculator'},'one')
        m=MCP(self.root)
        result=m.call('await_desktop_task',{'worker_id':'desktop','wait_seconds':0},threading.Event())
        claim=result['task'];self.assertEqual(claim['id'],a)
        with self.assertRaises(TaskError):
            m.call('complete_desktop_task',{'task_id':a,'claim_token':claim['claim_token'],'response':claim['claim_token']},threading.Event())
        m.call('complete_desktop_task',{'task_id':a,'claim_token':claim['claim_token'],'response':'Actual UI evidence'},threading.Event())
        self.assertEqual(self.q.get(a)['status'],'completed')

    def test_cancelled_wait_claims_nothing(self):
        a,_=self.q.accept({'body':'hello'},'one')
        m=MCP(self.root);cancelled=threading.Event();cancelled.set()
        with self.assertRaises(TaskError):m.call('await_desktop_task',{'worker_id':'desktop','wait_seconds':30},cancelled)
        self.assertEqual(self.q.get(a)['status'],'queued')


class DesktopHTTPTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        (self.root/'token').write_text('t'*48)
        self.server=Bridge(('127.0.0.1',0),self.root,start_worker=False)
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
        self.server.desktop_token='d'*48

    tearDown = test_bridge.InboxTest.tearDown
    request = test_bridge.InboxTest.request

    def test_notification_key_cannot_start_desktop_tasks(self):
        self.assertEqual(self.request('POST','/v1/desktop/tasks',{'body':'Open Calculator'},dedupe='task')[0],401)
        # Use a desktop token and verify the receipt does not enter the notification model queue.
        self.server.desktop_token='t'*48
        status,r=self.request('POST','/v1/desktop/tasks',{'body':'Open Calculator'},dedupe='task')
        self.assertEqual(status,202)
        self.assertTrue(r['status_url'].startswith('/v1/desktop/tasks/'))
        self.assertEqual(self.request('GET',r['status_url'])[1]['status'],'queued')
        self.assertIsNone(self.server.store.claim())
        self.assertEqual(self.request('POST','/v1/desktop/tasks',{'body':'Open Calculator'})[0],400)


if __name__=='__main__':unittest.main()
