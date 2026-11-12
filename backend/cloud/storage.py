"""Private R2 storage. Keys never depend on user-supplied filenames."""
import os
from .service import required

def r2():
    import boto3
    from botocore.config import Config
    return boto3.client('s3', endpoint_url=f"https://{required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com",
                        aws_access_key_id=required('R2_ACCESS_KEY_ID'), aws_secret_access_key=required('R2_SECRET_ACCESS_KEY'),
                        region_name='auto', config=Config(signature_version='s3v4', connect_timeout=10, read_timeout=25))

def bucket():
    return required('R2_BUCKET')

def sign(operation, key, content_type=None, content_length=None):
    params = {'Bucket': bucket(), 'Key': key}
    if content_type: params['ContentType'] = content_type
    if content_length is not None: params['ContentLength'] = content_length
    return r2().generate_presigned_url(operation, Params=params, ExpiresIn=300)
