import os
import unittest
from unittest.mock import AsyncMock, Mock, patch
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from lib.auth import get_current_user
from routers.github import CommitRequest, commit_files, FileRequest, edit_file
from routers.rag import _is_indexable

class AuthTests(unittest.TestCase):
    @patch('lib.auth.get_supabase')
    def test_operator_restriction(self, db):
        db.return_value.auth.get_user.return_value.user.id = 'alice'
        token = HTTPAuthorizationCredentials(scheme='Bearer', credentials='test')
        with patch.dict(os.environ, {'CORTEX_OPERATOR_ID': 'bob'}):
            with self.assertRaises(HTTPException) as e:
                get_current_user(token)
            self.assertEqual(e.exception.status_code, 403)
        with patch.dict(os.environ, {'CORTEX_OPERATOR_ID': 'alice'}):
            self.assertEqual(get_current_user(token)['user_id'], 'alice')

    def test_secret_exclusion(self):
        for path in ['.env', '.env.production', 'app/.env.local']:
            self.assertFalse(_is_indexable(path))
        self.assertTrue(_is_indexable('src/main.py'))

class CommitTests(unittest.IsolatedAsyncioTestCase):
    @patch('routers.github.gh_post', new_callable=AsyncMock)
    @patch('routers.github.gh_fetch', new_callable=AsyncMock)
    @patch('routers.github.gh_headers', new_callable=AsyncMock)
    async def test_stale_file_never_writes(self, headers, fetch, post):
        headers.return_value = {'Authorization': 'Bearer test'}
        def response(data):
            r = Mock(is_success=True, status_code=200)
            r.json.return_value = data
            return r
        fetch.side_effect = [response({'object': {'sha': 'b'*40}}),
                             response({'tree': {'sha': 'c'*40}}),
                             response({'sha': 'd'*40})]
        body = CommitRequest(owner='owner', repo='repo', branch='main', message='edit',
                             files=[{'path':'main.py','content':'new','expectedSha':'a'*40}])
        with self.assertRaises(HTTPException) as e:
            await commit_files(body, {'user_id':'alice'})
        self.assertEqual(e.exception.status_code, 409)
        post.assert_not_awaited()

    @patch('routers.github.gh_fetch', new_callable=AsyncMock)
    @patch('routers.github.gh_headers', new_callable=AsyncMock)
    async def test_large_editor_file_rejected(self, headers, fetch):
        headers.return_value = {}
        r = Mock(is_success=True)
        r.json.return_value = {'type':'file','encoding':'base64','size':80001}
        fetch.return_value = r
        with self.assertRaises(HTTPException) as e:
            await edit_file(FileRequest(owner='o',repo='r',ref='main',path='f'), {})
        self.assertEqual(e.exception.status_code, 422)

if __name__ == '__main__':
    unittest.main()
