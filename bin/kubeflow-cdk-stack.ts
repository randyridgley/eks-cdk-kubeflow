import cdk = require('@aws-cdk/core');
import eks = require('@aws-cdk/aws-eks');
import iam = require('@aws-cdk/aws-iam');
import s3 = require('@aws-cdk/aws-s3');
import { Vpc, SubnetType } from '@aws-cdk/aws-ec2';

import { KubeflowCluster } from '../lib/kubeflow-cluster';
import { KubectlLambdaLayerVersion } from '../lib/kubectl-layer';
import { KfctlLambdaLayerVersion } from '../lib/kfctl-layer';
import { EKSConsole } from '../lib/eks-console';

import moment = require('moment');

export class KubeflowStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'VPC', {
      maxAzs: 3,
      cidr: "10.0.0.0/16",
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'private-eks',
          subnetType: SubnetType.PRIVATE,
        },
        {
          cidrMask: 24,
          name: 'public-alb-nat',
          subnetType: SubnetType.PUBLIC
        }
      ]
    });
    
    // first define the role
    const clusterAdmin = new iam.Role(this, 'AdminRole', {
      assumedBy: new iam.AccountRootPrincipal()
    });

    // The code that defines your stack goes here
    const cluster = new eks.Cluster(this, 'KubeflowCluster', {
      mastersRole: clusterAdmin,
      defaultCapacity: 6,         
      vpc: vpc,
      vpcSubnets: [ { 
        onePerAz: true,
        subnetType: SubnetType.PRIVATE
      } ],
      outputClusterName: true,
    });

    const clusterBucket = new s3.Bucket(this, 'clusterBucket', {
      bucketName: this.makeBucketName("kubeflow-demo")
    });

    new EKSConsole(this, 'eksConsole', {
      vpc: vpc
    });
    
    const kfctlLayer = new KfctlLambdaLayerVersion(this, 'KfctlLambdaLayer', {});
    const kubctlLayer = new KubectlLambdaLayerVersion(this, 'KubectlLambdaLayer', {});

    new KubeflowCluster(this, 'KfCluster', {
      cluster,
      layers: [
        kubctlLayer,
        kfctlLayer,
      ],
      configUrl: "https://raw.githubusercontent.com/kubeflow/manifests/v0.7-branch/kfdef/kfctl_aws.0.7.0.yaml",
      bucket: clusterBucket.bucketName,
      adminRole: clusterAdmin,
    });
  }

  makeBucketName(bucketSuffix: string) : string {
    return cdk.Aws.ACCOUNT_ID + moment().format('YYYYMMDDhhmmss') + bucketSuffix;
  }
}

const app = new cdk.App();
new KubeflowStack(app, 'KubeflowStack');
